from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict
from sentence_transformers import SentenceTransformer
import json, os, requests, re, uuid, faiss, time, logging
from requests.exceptions import RequestException

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

print("[STARTUP] Initializing KKH Nursing Chatbot API...")

# Store quizzes in memory
active_quizzes: Dict[str, List[Dict]] = {}

class QuizAnswer(BaseModel):
    question: str
    answer: str

class QuizEvaluateRequest(BaseModel):
    responses: List[QuizAnswer]

class AskRequest(BaseModel):
    question: str

class SuggestRequest(BaseModel):
    question: str

class UserResponse(BaseModel):
    question: str
    answer: str

class QuizEvalRequest(BaseModel):
    session_id: str
    responses: List[UserResponse]

app = FastAPI(title="KKH Nursing Chatbot API", version="1.0.0")

print("[STARTUP] Configuring CORS middleware...")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for production, or specify your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("[STARTUP] Loading sentence transformer model...")
embedding_model = SentenceTransformer("paraphrase-MiniLM-L3-v2")
print("[STARTUP] Sentence transformer model loaded successfully!")

kb_path = os.path.join("data", "nursing_guide_cleaned.txt")
try:
    with open(kb_path, 'r', encoding='utf-8') as file:
        knowledge_base = file.read()
    print(f"[INFO] Successfully loaded knowledge base from {kb_path}")
except FileNotFoundError:
    print(f"[WARNING] Knowledge base file not found at {kb_path}, using minimal fallback")
    knowledge_base = "Basic nursing knowledge: Always prioritize patient safety, follow infection control protocols, and maintain proper documentation."
except Exception as e:
    print(f"[ERROR] Failed to load knowledge base: {e}")
    knowledge_base = "Basic nursing knowledge: Always prioritize patient safety, follow infection control protocols, and maintain proper documentation."

def chunk_text(text, chunk_size=300, overlap=50):
    return [text[i:i + chunk_size] for i in range(0, len(text), chunk_size - overlap)]

chunks = chunk_text(knowledge_base)
print(f"[INFO] Created {len(chunks)} text chunks for vector search")

try:
    embeddings = embedding_model.encode(chunks)
    index = faiss.IndexFlatL2(embeddings.shape[1])
    index.add(embeddings)
    print(f"[INFO] Successfully initialized FAISS index with {len(embeddings)} embeddings")
except Exception as e:
    print(f"[ERROR] Failed to initialize FAISS index: {e}")
    # Create a minimal fallback index
    embeddings = embedding_model.encode(["Basic nursing knowledge"])
    index = faiss.IndexFlatL2(embeddings.shape[1])
    index.add(embeddings)

@app.post("/ask")
def ask_question(request: AskRequest):
    question_embedding = embedding_model.encode([request.question])
    distances, indices = index.search(question_embedding, k=3)
    context = "\n".join([chunks[i] for i in indices[0]])

    prompt = (
        f"You are a concise and helpful nursing assistant. "
        f"Based only on the context below, give a brief answer in 1-2 sentences. Avoid long explanations.\n\n"
        f"Context:\n{context}\n\n"
        f"Question:\n{request.question}"
    )

    try:
        response = requests.post("http://localhost:1234/v1/chat/completions", json={
            "model": "huggingfaceh4__zephyr-7b-beta",
            "messages": [
                {"role": "system", "content": "You are a helpful medical assistant."},
                {"role": "user", "content": prompt}
            ]
        }, timeout=30)

        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="Error querying Zephyr-7B-Beta")

        result = response.json()
        answer = result.get("choices", [{}])[0].get("message", {}).get("content", "No response generated.")
        return {"response": answer}
    
    except requests.exceptions.ConnectionError:
        # Fallback when LM Studio is not available
        return {"response": f"Based on the nursing knowledge base: {context[:200]}... Please consult with healthcare professionals for specific medical advice."}
    except requests.exceptions.Timeout:
        return {"response": "Service temporarily unavailable. Please try again later."}
    except Exception as e:
        return {"response": f"Based on the context provided: {context[:200]}... For detailed medical guidance, please consult healthcare professionals."}

def extract_json_from_text(text: str):
    try:
        text = text.encode().decode('unicode_escape').replace('\n', '').replace('\\', '')
        match = re.search(r'\[\s*\{.*?\}\s*\]', text, re.DOTALL)
        if not match:
            raise ValueError("No valid JSON array found.")
        raw_list = json.loads(match.group(0))

        converted = []
        for item in raw_list:
            options = [item[k] for k in ['option1', 'option2', 'option3', 'option4'] if k in item]
            answer = item.get("answer", "").strip()

            # ✅ Normalize answer to match one of the options
            matched_answer = next((opt for opt in options if normalize(opt) == normalize(answer)), None)

            if not matched_answer:
                # 🔁 If no matching option, fallback to first option or mark as invalid
                matched_answer = options[0] if options else ""

            converted.append({
                "question": item.get("question", "").strip(),
                "options": options,
                "answer": matched_answer
            })

        return converted
    except Exception as e:
        raise ValueError(f"Quiz parse failed: {e}")

def normalize(s):
    return re.sub(r'\W+', '', s).lower()



# 🔁 Simple quiz cache - now supports topic-specific caching
quiz_cache = {}

# 📝 Track previously generated questions to avoid repetition
question_history: Dict[str, List[str]] = {}

@app.get("/quiz")
def generate_quiz(n: int = 10, prompt: str = "", topic: str = "General", session_id: str = None):
    now = time.time()

    # Create cache key that includes topic to cache topic-specific quizzes
    cache_key = f"{topic}_{n}"
    
    # ✅ Step 1: Use cache if recent (topic-specific)
    if quiz_cache.get(cache_key) and quiz_cache[cache_key]["data"] and (now - quiz_cache[cache_key]["timestamp"] < quiz_cache[cache_key]["ttl"]):
        # Use provided session_id or generate new one
        if not session_id:
            session_id = str(uuid.uuid4())
        active_quizzes[session_id] = quiz_cache[cache_key]["data"]
        return {"quiz": quiz_cache[cache_key]["data"], "session_id": session_id}

    # ✅ Step 2: Set default prompt before try block (this avoids unreachable warning)
    if not prompt:
        if topic and topic.lower() != "general":
            # Get previously asked questions for this topic to avoid repetition
            previous_questions = question_history.get(topic, [])
            
            prompt = (
                f"Generate exactly {n} unique multiple-choice nursing questions STRICTLY about '{topic}'. "
                f"Focus ONLY on {topic} - do not include general nursing questions or questions from other topics. "
                "Return ONLY a JSON array in this exact format:\n"
                "[\n"
                '  {"question": "What is...", "option1": "A", "option2": "B", "option3": "C", "option4": "D", "answer": "A"}\n'
                "]\n"
                f"STRICT REQUIREMENTS:\n"
                f"- ALL questions must be specifically about {topic} nursing care, procedures, assessment, or management\n"
                f"- Each question must have exactly 4 distinct, non-overlapping answer options (option1-option4)\n"
                f"- Each question must have exactly ONE clearly correct answer that matches one of the 4 options\n"
                f"- NO contradictory answers - avoid options that could both be considered correct\n"
                f"- NO vague, ambiguous, or overly similar answer choices\n"
                f"- AVOID 'all of the above', 'none of the above', or true/false formats\n"
                f"- Use phrases like 'best approach', 'most appropriate', or 'priority action' if needed for clarity\n"
                f"- Make questions practical and clinically relevant to {topic}\n"
                f"- Focus on application, critical thinking, and clinical decision-making\n"
                f"- Questions should test knowledge specific to {topic}, not general nursing principles\n"
                f"- Each answer option should be clearly distinct and not overlap with others\n"
                f"- Ensure the correct answer is definitively the BEST choice among the 4 options\n"
                f"- Base correct answers on current evidence-based nursing practice and clinical guidelines\n"
                f"- Make incorrect options plausible but clearly wrong to experienced nurses\n"
            )
            
            # Add instruction to avoid previously asked questions if any exist
            if previous_questions:
                recent_questions = previous_questions[-10:]  # Show last 10 to avoid very long prompts
                prompt += (
                    f"\nIMPORTANT: Do NOT repeat or rephrase any of these previously asked questions:\n"
                    + "\n".join([f"- {q}" for q in recent_questions])
                    + "\n\nGenerate completely NEW and DIFFERENT questions about the same topic.\n"
                )
        else:
            # Enhanced general nursing prompt
            previous_questions = question_history.get("General", [])
            
            prompt = (
                f"Generate exactly {n} diverse nursing multiple-choice questions covering different areas of general nursing practice. "
                "Return ONLY a JSON array in this exact format:\n"
                "[\n"
                '  {"question": "What is...", "option1": "A", "option2": "B", "option3": "C", "option4": "D", "answer": "A"}\n'
                "]\n"
                f"STRICT REQUIREMENTS:\n"
                f"- Cover diverse nursing topics (medication admin, patient safety, assessment, etc.)\n"
                f"- Each question must have exactly 4 distinct, non-overlapping answer options (option1-option4)\n"
                f"- Each question must have exactly ONE clearly correct answer that matches one of the 4 options\n"
                f"- NO contradictory answers - avoid options that could both be considered correct\n"
                f"- NO vague, ambiguous, or overly similar answer choices\n"
                f"- AVOID 'all of the above', 'none of the above', or true/false formats\n"
                f"- Use phrases like 'best approach', 'most appropriate', or 'priority action' if needed for clarity\n"
                f"- Make questions practical and clinically relevant to nursing practice\n"
                f"- Focus on application, critical thinking, and clinical decision-making\n"
                f"- Each answer option should be clearly distinct and not overlap with others\n"
                f"- Ensure the correct answer is definitively the BEST choice among the 4 options\n"
                f"- Test real-world nursing scenarios and evidence-based practice\n"
                f"- Base correct answers on current evidence-based nursing practice and clinical guidelines\n"
                f"- Make incorrect options plausible but clearly wrong to experienced nurses\n"
            )
            
            # Add instruction to avoid previously asked questions if any exist
            if previous_questions:
                recent_questions = previous_questions[-8:]  # Show fewer for general to keep prompt manageable
                prompt += (
                    f"\nIMPORTANT: Do NOT repeat any of these previously asked questions:\n"
                    + "\n".join([f"- {q}" for q in recent_questions])
                    + "\n\nGenerate completely NEW and DIFFERENT questions.\n"
                )

    # ✅ Step 3: Try generating quiz
    try:
        response = generate_with_model(prompt)
        parsed = extract_json_from_text(response)

        if not parsed or len(parsed) == 0:
            return {"error": "No valid quiz questions were generated. Please check LM Studio connection."}

        # Filter out any duplicate questions
        unique_questions = []
        for q in parsed:
            if isinstance(q, dict) and 'question' in q:
                if is_question_unique(q['question'], topic):
                    unique_questions.append(q)
                else:
                    print(f"[DEBUG] Filtered out duplicate question: {q['question'][:50]}...")
        
        # If we filtered out too many questions, try to generate more
        if len(unique_questions) < max(1, n // 2):  # If we have less than half the requested questions
            print(f"[DEBUG] Only {len(unique_questions)} unique questions generated, retrying...")
            # Try once more with a stronger uniqueness instruction
            enhanced_prompt = prompt + f"\n\nCRITICAL: Generate {n} COMPLETELY UNIQUE questions. No repeats or variations of common nursing questions."
            response = generate_with_model(enhanced_prompt)
            parsed_retry = extract_json_from_text(response)
            
            if parsed_retry:
                for q in parsed_retry:
                    if isinstance(q, dict) and 'question' in q and is_question_unique(q['question'], topic):
                        unique_questions.append(q)
                        if len(unique_questions) >= n:
                            break
        
        final_questions = unique_questions[:n] if len(unique_questions) >= n else unique_questions
        
        if len(final_questions) == 0:
            return {"error": "Unable to generate unique quiz questions. Please try a different topic."}

        # Add the generated questions to history
        add_questions_to_history(final_questions, topic)

        # Cache the result with topic-specific key
        quiz_cache[cache_key] = {
            "data": final_questions,
            "timestamp": now,
            "ttl": 300  # seconds = 5 minutes
        }

        # Use provided session_id or generate new one
        if not session_id:
            session_id = str(uuid.uuid4())
        
        # Store the quiz data
        active_quizzes[session_id] = final_questions
        
        print(f"[DEBUG] Generated quiz for session {session_id} (topic: {topic})")
        print(f"[DEBUG] Number of questions stored: {len(final_questions)}")
        print(f"[DEBUG] Questions generated from {len(parsed)} total, {len(unique_questions)} unique, {len(final_questions)} final")
        for i, q in enumerate(final_questions):
            print(f"[DEBUG] Q{i+1}: {q.get('question', 'NO QUESTION')[:50]}...")
            print(f"[DEBUG] Answer: {q.get('answer', 'NO ANSWER')}")
        
        return {"quiz": final_questions, "session_id": session_id}

    except requests.exceptions.ConnectionError:
        return {"error": "Cannot connect to LM Studio. Please ensure LM Studio is running on localhost:1234."}
    except Exception as e:
        return {"error": f"Failed to generate quiz: {str(e)}"}

def generate_with_model(query: str):
    try:
        response = requests.post(
            "http://localhost:1234/v1/chat/completions",
            json={
                "model": "huggingfaceh4__zephyr-7b-beta",
                "messages": [
                    {"role": "system", "content": "You are a helpful medical assistant."},
                    {"role": "user", "content": query}
                ],
                "max_tokens": 2000,
                "temperature": 0.7
            },
            timeout=30
        )

        if response.status_code != 200:
            raise HTTPException(status_code=500, detail=f"LM Studio returned status {response.status_code}")

        result = response.json()
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not content:
            raise HTTPException(status_code=500, detail="LM Studio returned empty response")

        return content
    
    except requests.exceptions.ConnectionError:
        # Fallback response when LM Studio is not available
        if "quiz" in query.lower():
            return '''[
                {"question": "What is the most important principle in nursing care?", "option1": "Patient safety", "option2": "Cost efficiency", "option3": "Speed of care", "option4": "Documentation", "answer": "Patient safety"},
                {"question": "When should you wash your hands?", "option1": "Only when visibly dirty", "option2": "Before and after patient contact", "option3": "Once per shift", "option4": "Only after procedures", "answer": "Before and after patient contact"}
            ]'''
        else:
            return "I apologize, but the advanced AI service is currently unavailable. Please try again later or consult with healthcare professionals for specific medical advice."
    
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Service timeout - please try again later")
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Service error: {str(e)}")

def normalize(text):
    return text.strip().lower().lstrip('abcd. ').strip()

def normalize_question(question):
    """Normalize question text for consistent matching"""
    return question.strip().lower().replace('\n', ' ').replace('\r', ' ').replace('  ', ' ').strip()

@app.post("/quiz/evaluate")
def evaluate_quiz(request: QuizEvalRequest):
    quiz = active_quizzes.get(request.session_id, [])
    results = []

    print(f"[DEBUG] Evaluating quiz for session: {request.session_id}")
    print(f"[DEBUG] Available sessions in active_quizzes: {list(active_quizzes.keys())}")
    print(f"[DEBUG] Quiz data available: {len(quiz)} questions")
    print(f"[DEBUG] User submitted: {len(request.responses)} responses")
    
    if not quiz:
        print(f"[ERROR] No quiz data found for session {request.session_id}")
        # Return error responses for all questions
        for user_response in request.responses:
            results.append({
                "question": user_response.question,
                "correct": False,
                "correctAnswer": "N/A",
                "explanation": "⚠️ Quiz session not found on server. Please try reloading the quiz."
            })
        return results

    for i, user_response in enumerate(request.responses):
        print(f"\n[DEBUG] Question {i+1}:")
        print(f"[DEBUG] User question: '{user_response.question}'")
        print(f"[DEBUG] User answer: '{user_response.answer}'")
        
        # Use normalized question matching
        normalized_user_question = normalize_question(user_response.question)
        
        correct_answer = None
        matched_question = None
        
        # Search for matching question using normalized comparison
        for q in quiz:
            normalized_stored_question = normalize_question(q["question"])
            print(f"[DEBUG] Comparing with stored: '{q['question']}'")
            print(f"[DEBUG] Normalized user: '{normalized_user_question}'")
            print(f"[DEBUG] Normalized stored: '{normalized_stored_question}'")
            
            if normalized_stored_question == normalized_user_question:
                correct_answer = q["answer"]
                matched_question = q
                print(f"[DEBUG] MATCH FOUND! Correct answer: '{correct_answer}'")
                break
        
        if not correct_answer:
            print(f"[DEBUG] NO MATCH FOUND for question {i+1}")
            results.append({
                "question": user_response.question,
                "correct": False,
                "correctAnswer": "N/A",
                "explanation": "⚠️ Correct answer not available for this question."
            })
            continue

        try:
            correct = normalize(user_response.answer) == normalize(correct_answer)
            print(f"[DEBUG] Answer comparison - User: '{normalize(user_response.answer)}' vs Correct: '{normalize(correct_answer)}' = {correct}")
        except:
            correct = False
            print(f"[DEBUG] Error in answer comparison")

        if correct:
            explanation = ""
        else:
            prompt = (
                f"The user answered the following nursing quiz question incorrectly:\n\n"
                f"Question: {user_response.question}\n"
                f"User's Answer: {user_response.answer}\n"
                f"Correct Answer: {correct_answer}\n\n"
                f"Briefly explain the correct choice in 1-2 sentences only."
            )
            try:
                explanation = generate_with_model(prompt)
                explanation = ". ".join(explanation.split(". ")[:2]).strip() + "."
            except:
                explanation = "Explanation unavailable."

        results.append({
            "question": user_response.question,
            "correct": correct,
            "correctAnswer": correct_answer,
            "explanation": explanation
        })

    return results

@app.post("/suggest")
def suggest_follow_up(request: SuggestRequest):
    try:
        prompt = (
            f"Based on this nursing question: '{request.question}'\n\n"
            f"Generate exactly 3 short, relevant follow-up questions that a nursing student might ask. "
            f"Return ONLY a JSON array of strings in this exact format:\n"
            f'["Question 1?", "Question 2?", "Question 3?"]\n\n'
            f"Focus on practical nursing care, safety considerations, or patient education related to the topic. "
            f"Keep each question under 15 words."
        )
        
        response = generate_with_model(prompt)
        
        # Extract JSON array from response
        try:
            # Look for JSON array pattern
            import re
            match = re.search(r'\[(.*?)\]', response, re.DOTALL)
            if match:
                json_str = '[' + match.group(1) + ']'
                suggestions = json.loads(json_str)
                
                # Validate that we have a list of strings
                if isinstance(suggestions, list) and len(suggestions) > 0:
                    # Clean and validate suggestions
                    cleaned_suggestions = []
                    for suggestion in suggestions[:3]:  # Limit to 3
                        if isinstance(suggestion, str) and len(suggestion.strip()) > 0:
                            cleaned_suggestions.append(suggestion.strip())
                    
                    if len(cleaned_suggestions) > 0:
                        return {"suggestions": cleaned_suggestions}
            
            # Fallback if parsing fails
            return {"suggestions": [
                "Can you explain more about this topic?",
                "What are the key nursing considerations?",
                "When should I seek medical help?"
            ]}
            
        except json.JSONDecodeError:
            # Fallback suggestions if JSON parsing fails
            return {"suggestions": [
                "What are the nursing interventions for this?",
                "How do I monitor the patient's condition?",
                "What patient education should I provide?"
            ]}
    
    except Exception as e:
        return {"error": f"Failed to generate suggestions: {str(e)}"}

@app.get("/")
def read_root():
    return {"message": "KKH Nursing Chatbot API is running."}

@app.get("/health")
def health_check():
    """Health check endpoint for deployment monitoring"""
    return {
        "status": "healthy",
        "message": "API is running",
        "features": {
            "knowledge_base_loaded": len(chunks) > 0,
            "vector_index_ready": index.ntotal > 0,
            "embedding_model_loaded": embedding_model is not None
        }
    }

def normalize_question_for_comparison(question: str) -> str:
    """Normalize question text for comparison to detect duplicates."""
    return re.sub(r'[^\w\s]', '', question.lower().strip())

def is_question_unique(question: str, topic: str) -> bool:
    """Check if a question is unique for the given topic."""
    if topic not in question_history:
        return True
    
    normalized_question = normalize_question_for_comparison(question)
    existing_questions = [normalize_question_for_comparison(q) for q in question_history[topic]]
    
    return normalized_question not in existing_questions

def add_questions_to_history(questions: List[Dict], topic: str):
    """Add generated questions to the history for the given topic."""
    if topic not in question_history:
        question_history[topic] = []
    
    for q in questions:
        if isinstance(q, dict) and 'question' in q:
            question_history[topic].append(q['question'])
    
    # Keep only the last 50 questions per topic to prevent memory bloat
    question_history[topic] = question_history[topic][-50:]

@app.get("/quiz/history")
def get_question_history():
    """Get the history of generated questions for debugging purposes."""
    return {
        "question_history": {
            topic: {
                "count": len(questions),
                "recent_questions": questions[-5:] if questions else []  # Show last 5 questions
            }
            for topic, questions in question_history.items()
        }
    }

@app.delete("/quiz/history/{topic}")
def clear_topic_history(topic: str):
    """Clear question history for a specific topic."""
    if topic in question_history:
        del question_history[topic]
        return {"message": f"Cleared question history for topic: {topic}"}
    else:
        return {"message": f"No history found for topic: {topic}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

