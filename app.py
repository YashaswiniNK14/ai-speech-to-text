import json
from simple_websocket import ConnectionClosed
import queue
import threading

from flask_sock import Sock
from websocket import (
    create_connection,
    ABNF,
    WebSocketTimeoutException
)
import os
import mysql.connector
from flask import Flask, jsonify, request, render_template
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
sock = Sock(app)


# def get_db_connection():
#     return mysql.connector.connect(
#         host=os.getenv("DB_HOST"),
#         user=os.getenv("DB_USER"),
#         password=os.getenv("DB_PASSWORD"),
#         database=os.getenv("DB_NAME")
#     )

def get_db_connection():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", 4000)),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
        ssl_ca=os.path.join(
            os.path.dirname(__file__),
            "tidb-ca.pem"
        ),
        ssl_verify_cert=True
    )


@app.route("/")
def home():
    return render_template("index.html")

@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


# @app.route("/test-db")
# def test_db():
#     try:
#         connection = get_db_connection()
#         connection.close()
#         return jsonify({
#             "success": True,
#             "message": "MySQL connected successfully!"
#         })
#     except mysql.connector.Error as error:
#         app.logger.exception("Database connection failed")
#         return jsonify({
#             "success": False,
#             "message": "Database connection failed."
#         }), 500

@app.route("/test-db")
def test_db():
    try:
        connection = get_db_connection()
        connection.close()

        return jsonify({
            "success": True,
            "message": "TiDB connected successfully!"
        })

    except mysql.connector.Error as error:
        app.logger.exception("Database connection failed")

        return jsonify({
            "success": False,
            "error_type": type(error).__name__,
            "message": str(error)
        }), 500


# CREATE: Save a transcription
@app.route("/api/transcriptions", methods=["POST"])
def create_transcription():
    data = request.get_json(silent=True) or {}
    transcript = data.get("transcript", "").strip()
    title = data.get("title", "Untitled Transcription").strip()
    language = data.get("language", "Unknown").strip()

    if not transcript:
        return jsonify({"error": "Transcript cannot be empty."}), 400

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            INSERT INTO transcriptions (title, transcript, language)
            VALUES (%s, %s, %s)
            """,
            (title or "Untitled Transcription", transcript, language or "Unknown")
        )
        connection.commit()
        new_id = cursor.lastrowid

        return jsonify({
            "message": "Transcription saved successfully.",
            "id": new_id
        }), 201

    except mysql.connector.Error:
        app.logger.exception("Could not save transcription")
        return jsonify({"error": "Could not save transcription."}), 500

    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


# READ: Get all transcriptions
@app.route("/api/transcriptions", methods=["GET"])
def get_transcriptions():
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT id, title, transcript, language, created_at, updated_at
            FROM transcriptions
            ORDER BY created_at DESC, id DESC
            """
        )
        records = cursor.fetchall()

        for record in records:
            for field in ("created_at", "updated_at"):
                if record[field]:
                    record[field] = record[field].isoformat(sep=" ")

        return jsonify(records)

    except mysql.connector.Error:
        app.logger.exception("Could not retrieve transcriptions")
        return jsonify({"error": "Could not retrieve transcriptions."}), 500

    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


# READ: Get one transcription
@app.route("/api/transcriptions/<int:transcription_id>", methods=["GET"])
def get_transcription(transcription_id):
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT id, title, transcript, language, created_at, updated_at
            FROM transcriptions
            WHERE id = %s
            """,
            (transcription_id,)
        )
        record = cursor.fetchone()

        if not record:
            return jsonify({"error": "Transcription not found."}), 404

        for field in ("created_at", "updated_at"):
            if record[field]:
                record[field] = record[field].isoformat(sep=" ")

        return jsonify(record)

    except mysql.connector.Error:
        app.logger.exception("Could not retrieve transcription")
        return jsonify({"error": "Could not retrieve transcription."}), 500

    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


# UPDATE: Edit a transcription
@app.route("/api/transcriptions/<int:transcription_id>", methods=["PUT"])
def update_transcription(transcription_id):
    data = request.get_json(silent=True) or {}

    if not any(field in data for field in ("title", "transcript", "language")):
        return jsonify({"error": "Provide a title, transcript, or language to update."}), 400

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            "SELECT id, title, transcript, language FROM transcriptions WHERE id = %s",
            (transcription_id,)
        )
        existing = cursor.fetchone()

        if not existing:
            return jsonify({"error": "Transcription not found."}), 404

        title = data.get("title", existing["title"])
        transcript = data.get("transcript", existing["transcript"])
        language = data.get("language", existing["language"])

        if not isinstance(transcript, str) or not transcript.strip():
            return jsonify({"error": "Transcript cannot be empty."}), 400

        cursor.execute(
            """
            UPDATE transcriptions
            SET title = %s, transcript = %s, language = %s
            WHERE id = %s
            """,
            (title, transcript, language, transcription_id)
        )
        connection.commit()

        return jsonify({"message": "Transcription updated successfully."})

    except mysql.connector.Error:
        app.logger.exception("Could not update transcription")
        return jsonify({"error": "Could not update transcription."}), 500

    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


# DELETE: Remove a transcription
@app.route("/api/transcriptions/<int:transcription_id>", methods=["DELETE"])
def delete_transcription(transcription_id):
    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            "DELETE FROM transcriptions WHERE id = %s",
            (transcription_id,)
        )

        if cursor.rowcount == 0:
            return jsonify({"error": "Transcription not found."}), 404

        connection.commit()
        return jsonify({"message": "Transcription deleted successfully."})

    except mysql.connector.Error:
        app.logger.exception("Could not delete transcription")
        return jsonify({"error": "Could not delete transcription."}), 500

    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()



@sock.route("/ws/transcribe")
def live_transcription(client_ws):

    api_key = os.getenv("CHARIOT_API_KEY")

    if not api_key:
        client_ws.send(json.dumps({
            "type": "error",
            "message": "Chariot API key is not configured."
        }))
        return

    url = (
        "wss://api.chariot.in/v1/asr/ws"
        "?model_type=chariot-1-asr-realtime&language=none"
    )

    upstream = None
    receiver = None
    event_queue = queue.Queue()
    stop_receiver = threading.Event()

    try:
        upstream = create_connection(
            url,
            header=[f"chariotai-api-key: {api_key}"],
            timeout=15,
            enable_multithread=True
        )

        started = json.loads(upstream.recv())

        if started.get("type") != "session.started":
            raise RuntimeError(
                started.get("message", "Chariot session failed.")
            )

        upstream.settimeout(1)

        client_ws.send(json.dumps({
            "type": "ready",
            "message": "Connected to Chariot ASR."
        }))

        # Receiver thread only reads Chariot events.
        # It never sends or closes the browser connection.
        def receive_chariot_events():

            while not stop_receiver.is_set():

                try:
                    message = upstream.recv()

                    if not message:
                        continue

                    event = json.loads(message)
                    event_queue.put(event)

                    if event.get("type") in (
                        "transcript.done",
                        "error"
                    ):
                        break

                except WebSocketTimeoutException:
                    continue

                except Exception as error:
                    event_queue.put({
                        "type": "error",
                        "message": str(error)
                    })
                    break

        receiver = threading.Thread(
            target=receive_chariot_events,
            daemon=True
        )
        receiver.start()

        # Main thread handles all browser WebSocket communication.
        while True:

            message = client_ws.receive()

            if message is None:
                break

            if isinstance(message, bytes):

                upstream.send(
                    message,
                    opcode=ABNF.OPCODE_BINARY
                )

                # Forward any available interim events.
                while True:
                    try:
                        event = event_queue.get_nowait()
                    except queue.Empty:
                        break

                    client_ws.send(json.dumps(event))

                    if event.get("type") in (
                        "transcript.done",
                        "error"
                    ):
                        return

            else:

                data = json.loads(message)

                if data.get("type") == "input.done":

                    upstream.send(json.dumps({
                        "type": "input.done"
                    }))

                    # Wait for final transcription.
                    while True:

                        try:
                            event = event_queue.get(timeout=30)

                        except queue.Empty:
                            client_ws.send(json.dumps({
                                "type": "error",
                                "message": "Transcription timed out."
                            }))
                            break

                        client_ws.send(json.dumps(event))

                        if event.get("type") in (
                            "transcript.done",
                            "error"
                        ):
                            break

                        

    except ConnectionClosed:
        app.logger.info("Browser disconnected.")

    except Exception:
        app.logger.exception("Live transcription failed.")

        try:
            client_ws.send(json.dumps({
                "type": "error",
                "message": "Speech recognition connection failed."
            }))
        except Exception:
            pass

    finally:

        stop_receiver.set()

        if upstream:
            try:
                upstream.close()
            except Exception:
                pass

        if receiver and receiver.is_alive():
            receiver.join(timeout=2)

        try:
            client_ws.close()
        except Exception:
            pass


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        threaded=True,
        use_reloader=False
    )