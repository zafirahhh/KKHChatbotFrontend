# Medical Chatbot with Zephyr-7B-Beta + Nomic Embeddings + Quiz Feature

## Objective
Build a fully functional chatbot for nursing education that:
- Answers medical questions using a local knowledge base and Zephyr-7B-Beta LLM
- Supports a quiz system with MCQs and explanations
- Has a FastAPI backend and an HTML/JS frontend
- Uses `nomic-embed-text-v1.5` for semantic similarity search with FAISS

## Features
### Backend
- **Knowledge Base**: Load and preprocess `nursing_guide_cleaned.txt`.
- **FAISS Index**: Embed text chunks and perform semantic similarity search.
- **Endpoints**:
  - `/ask`: Answer user questions using Zephyr-7B-Beta.
  - `/quiz`: Serve random quiz questions.
  - `/quiz/evaluate`: Evaluate user answers and provide feedback.

### Frontend
- **Chat UI**: Interactive chat window for user queries.
- **Quiz Feature**: Start quiz, select answers, and view feedback.
- **Dynamic Updates**: Seamless integration with backend.

## Setup
### Backend
1. Install dependencies:
   ```bash
   pip install fastapi uvicorn faiss-cpu sentence-transformers requests
   ```
2. Run the server:
   ```bash
   uvicorn main:app --reload
   ```

### Frontend
1. Open `index.html` in a browser.

## Data
- `data/nursing_guide_cleaned.txt`: Medical knowledge base.
- `data/quiz_questions.json`: Quiz questions.

## Tools
- **LLM**: Zephyr-7B-Beta via LM Studio.
- **Embedding Model**: `nomic-embed-text-v1.5`.
- **Text Search**: FAISS.
- **Backend**: FastAPI.
- **Frontend**: HTML/CSS + JavaScript.

## Goal
Create a fast, accurate, and interactive chatbot with:
- Context-aware responses based on embedded document.
- Interactive quiz mode for nursing students.
- Clean ChatGPT-like UI using HTML, CSS, and JavaScript.
