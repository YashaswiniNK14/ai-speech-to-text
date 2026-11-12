
const transcriptionList = document.getElementById("transcriptionList");
const dashboardMessage = document.getElementById("dashboardMessage");
const searchInput = document.getElementById("searchInput");

let allTranscriptions = [];

async function loadTranscriptions() {
    transcriptionList.textContent = "Loading transcriptions...";

    try {
        const response = await fetch("/api/transcriptions");
        const records = await response.json();

        if (!response.ok) {
            throw new Error(records.error || "Could not load transcriptions.");
        }

        allTranscriptions = records;
        renderTranscriptions();
    } catch (error) {
        transcriptionList.textContent = error.message;
    }
}

function renderTranscriptions() {
    const searchTerm = searchInput.value.trim().toLowerCase();

    const filteredRecords = allTranscriptions.filter((record) => {
        const title = (record.title || "").toLowerCase();
        const transcript = (record.transcript || "").toLowerCase();

        return title.includes(searchTerm) || transcript.includes(searchTerm);
    });

    transcriptionList.replaceChildren();

    if (allTranscriptions.length === 0) {
        transcriptionList.textContent =
            "No saved transcriptions yet. Record some speech first!";
        return;
    }

    if (filteredRecords.length === 0) {
        transcriptionList.textContent = "No matching transcriptions found.";
        return;
    }

    filteredRecords.forEach((record) => {
        const card = document.createElement("article");
        card.className = "transcription-card";

        const title = document.createElement("h3");
        title.textContent = record.title;

        const language = document.createElement("p");
        language.textContent = "Language: " + record.language;

        const transcript = document.createElement("p");
        transcript.className = "transcript-content";
        transcript.textContent = record.transcript;

        const createdAt = document.createElement("p");
        createdAt.className = "record-date";
        createdAt.textContent = "Created: " + record.created_at;

        const actions = document.createElement("div");
        actions.className = "controls";

        const editButton = document.createElement("button");
        editButton.className = "primary";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => editTranscription(record));

        const deleteButton = document.createElement("button");
        deleteButton.className = "secondary";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener(
            "click",
            () => deleteTranscription(record.id)
        );

        actions.append(editButton, deleteButton);
        card.append(title, language, transcript, createdAt, actions);
        transcriptionList.appendChild(card);
    });
}

async function editTranscription(record) {
    const newTitle = prompt("Enter transcription title:", record.title);

    if (newTitle === null) return;

    const newTranscript = prompt(
        "Edit transcription text:",
        record.transcript
    );

    if (newTranscript === null) return;

    if (!newTranscript.trim()) {
        alert("Transcription text cannot be empty.");
        return;
    }

    try {
        const response = await fetch(`/api/transcriptions/${record.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: newTitle.trim() || "Untitled Transcription",
                transcript: newTranscript.trim()
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not update transcription.");
        }

        dashboardMessage.textContent = "Transcription updated successfully.";
        await loadTranscriptions();
    } catch (error) {
        dashboardMessage.textContent = error.message;
    }
}

async function deleteTranscription(id) {
    if (!confirm("Are you sure you want to delete this transcription?")) {
        return;
    }

    try {
        const response = await fetch(`/api/transcriptions/${id}`, {
            method: "DELETE"
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not delete transcription.");
        }

        dashboardMessage.textContent = "Transcription deleted successfully.";
        await loadTranscriptions();
    } catch (error) {
        dashboardMessage.textContent = error.message;
    }
}

searchInput.addEventListener("input", renderTranscriptions);

loadTranscriptions();
