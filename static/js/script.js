
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");

const transcriptBox = document.getElementById("transcript");
const languageSelect = document.getElementById("language");
const titleInput = document.getElementById("title");
const statusText = document.getElementById("status");
const messageText = document.getElementById("message");

let socket = null;
let mediaStream = null;
let audioContext = null;
let audioSource = null;
let processor = null;
let silentGain = null;

let isListening = false;
let committedTranscript = "";
let interimTranscript = "";
let receivedFinalResult = false;


// Convert browser audio into 16-bit PCM, 16 kHz, mono
function convertToPCM(input, sampleRate) {

    const targetRate = 16000;
    const ratio = sampleRate / targetRate;

    const outputLength = Math.floor(input.length / ratio);
    const output = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {

        const start = Math.floor(i * ratio);
        const end = Math.min(
            Math.floor((i + 1) * ratio),
            input.length
        );

        let sum = 0;

        for (let j = start; j < end; j++) {
            sum += input[j];
        }

        const average = sum / Math.max(1, end - start);

        const sample = Math.max(-1, Math.min(1, average));

        output[i] = sample < 0
            ? sample * 32768
            : sample * 32767;
    }

    return output;
}


// Start microphone audio processing
async function startAudioProcessing() {

    mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }
    });

    audioContext = new AudioContext();

    await audioContext.resume();

    audioSource = audioContext.createMediaStreamSource(mediaStream);

    processor = audioContext.createScriptProcessor(
        4096,
        1,
        1
    );

    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess = (event) => {

        if (
            !isListening ||
            !socket ||
            socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        const input = event.inputBuffer.getChannelData(0);

        const pcm = convertToPCM(
            input,
            audioContext.sampleRate
        );

        socket.send(pcm.buffer);
    };

    audioSource.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);

    isListening = true;

    startBtn.disabled = true;
    stopBtn.disabled = false;
    clearBtn.disabled = true;
    languageSelect.disabled = true;

    statusText.textContent = "Listening... Speak now!";
}


// Stop microphone and release resources
async function stopAudioProcessing() {

    isListening = false;

    if (processor) {
        processor.disconnect();
        processor.onaudioprocess = null;
        processor = null;
    }

    if (audioSource) {
        audioSource.disconnect();
        audioSource = null;
    }

    if (silentGain) {
        silentGain.disconnect();
        silentGain = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    if (audioContext) {
        await audioContext.close();
        audioContext = null;
    }
}


// Start listening
startBtn.addEventListener("click", async () => {

    committedTranscript = transcriptBox.value.trim();

    if (committedTranscript) {
        committedTranscript += " ";
    }

    interimTranscript = "";
    receivedFinalResult = false;

    messageText.textContent = "";
    statusText.textContent = "Connecting to Chariot ASR...";

    startBtn.disabled = true;

    try {

        // Request microphone permission
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        const protocol = location.protocol === "https:"
            ? "wss:"
            : "ws:";

        socket = new WebSocket(
            `${protocol}//${location.host}/ws/transcribe`
        );

        socket.onopen = () => {
            statusText.textContent =
                "Connected. Preparing microphone...";
        };

        socket.onmessage = async (event) => {

            console.log("SERVER MESSAGE:", event.data);

            const data = JSON.parse(event.data);

            if (data.type === "ready") {

                statusText.textContent =
                    "Connected. Starting microphone...";

                try {
                    await startAudioProcessing();
                } catch (error) {
                    statusText.textContent =
                        "Microphone error: " + error.message;

                    socket.close();
                }

            } else if (data.type === "transcript.delta") {

                interimTranscript += data.text || "";

                transcriptBox.value =
                    committedTranscript + interimTranscript;

            } else if (data.type === "transcript.committed") {

                committedTranscript +=
                    (data.text || "").trim() + " ";

                interimTranscript = "";

                transcriptBox.value =
                    committedTranscript;

            } else if (data.type === "transcript.done") {

                const finalText = data.text || "";

                const completeTranscript = [
                    committedTranscript.trim(),
                    finalText.trim()
                ].filter(Boolean).join(" ");

                transcriptBox.value = completeTranscript;

                committedTranscript = completeTranscript;
                interimTranscript = "";

                if (completeTranscript.trim().length > 0) {

                    receivedFinalResult = true;

                    statusText.textContent =
                    "Transcription completed successfully!";

                } else {

                    receivedFinalResult = false;

                    statusText.textContent =
                            "No speech detected. Please try again.";
                }

                // Re-enable controls immediately
                startBtn.disabled = false;
                stopBtn.disabled = true;
                clearBtn.disabled = false;
                languageSelect.disabled = false;

                // Stop microphone resources
                await stopAudioProcessing();


            } else if (data.type === "error") {

                statusText.textContent =
                    data.message || "Speech recognition error.";

                socket.close();
            }
        };

        
        socket.onerror = (event) => {

            console.error("WebSocket error:", event);

            // Don't overwrite a successful transcription status
            if (!receivedFinalResult) {
                statusText.textContent = "WebSocket connection error.";
            }
        };

        
        socket.onclose = async (event) => {

            console.log("CLOSE CODE:", event.code);
            console.log("CLOSE REASON:", event.reason);
            console.log("WAS CLEAN:", event.wasClean);

            // Enable controls immediately
            startBtn.disabled = false;
            stopBtn.disabled = true;
            clearBtn.disabled = false;
            languageSelect.disabled = false;

            // Clean up microphone resources
            try {
                await stopAudioProcessing();
            } catch (error) {
                console.error("Audio cleanup error:", error);
            }

            if (receivedFinalResult) {
                statusText.textContent =
                    "Transcription completed successfully!";
            } else if (!transcriptBox.value.trim()) {
                statusText.textContent =
                    "No speech detected. Please try again.";
            } else {
                statusText.textContent =
                    "Connection closed.";
            }
        };


    } catch (error) {

        await stopAudioProcessing();

        if (socket) {
            socket.close();
            socket = null;
        }

        startBtn.disabled = false;

        statusText.textContent =
            "Unable to start recording: " + error.message;
    }
});


// Stop listening and request final transcription
stopBtn.addEventListener("click", async () => {


    stopBtn.disabled = true;

    await stopAudioProcessing();

    statusText.textContent =
        "Recording stopped. Finalizing transcription...";

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: "input.done"
        }));
    }
});


// Clear transcript
clearBtn.addEventListener("click", () => {

    if (isListening) {
        return;
    }

    committedTranscript = "";
    interimTranscript = "";

    transcriptBox.value = "";
    messageText.textContent = "";

    statusText.textContent =
        "Text cleared. Ready to listen.";
});


// Save transcription to MySQL using existing Flask API
saveBtn.addEventListener("click", async () => {

    const transcript = transcriptBox.value.trim();

    if (!transcript) {
        messageText.textContent =
            "Please record or enter some text first.";
        return;
    }

    if (isListening) {
        messageText.textContent =
            "Please stop recording before saving.";
        return;
    }

    saveBtn.disabled = true;

    messageText.textContent =
        "Saving transcription...";

    try {

        const response = await fetch("/api/transcriptions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                title: titleInput.value.trim() ||
                    "Untitled Transcription",

                transcript: transcript,

                language: "Automatic multilingual detection"
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Could not save transcription."
            );
        }

        messageText.textContent =
            `"${titleInput.value.trim() || "Untitled Transcription"}" saved successfully!`;

    } catch (error) {

        messageText.textContent = error.message;

    } finally {

        saveBtn.disabled = false;
    }
});
