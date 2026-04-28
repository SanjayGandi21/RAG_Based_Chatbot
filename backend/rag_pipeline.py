import os
import chromadb
import json
from groq import Groq
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv
from typing import TypedDict, List
from langgraph.graph import StateGraph, END

load_dotenv()

# --- 1. Initialization ---
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection("rag_docs")
embedder = SentenceTransformer("all-MiniLM-L6-v2")
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# --- 2. Define the Graph State ---
class AgentState(TypedDict):
    question: str
    target_file: str
    intent: str
    answer: str
    sources: List[str]
    needs_human: bool

# --- 3. Define Nodes (The "Process" Steps) ---

def router_node(state: AgentState) -> AgentState:
    """Analyzes the user query and determines the intent."""
    question = state["question"]
    
    prompt = f"""You are a customer support intent classifier. Analyze the user's message and categorize it into exactly one of these intents:
    - 'greeting': Simple hellos, how are you, etc.
    - 'escalate': The user is angry, frustrated, or explicitly asking for a human/agent.
    - 'rag_query': The user is asking a question about a product, policy, or document.

    Message: "{question}"
    
    Respond ONLY with a JSON object in this exact format: {{"intent": "value"}}"""

    response = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        response_format={"type": "json_object"}
    )
    
    try:
        intent = json.loads(response.choices[0].message.content).get("intent", "rag_query")
    except:
        intent = "rag_query" # Fallback
        
    return {"intent": intent}


def greeting_node(state: AgentState) -> AgentState:
    """Handles simple greetings without searching the database."""
    return {
        "answer": "Hello! I am your RAG Support Assistant. How can I help you with your documents today?",
        "sources": [],
        "needs_human": False
    }


def hitl_escalation_node(state: AgentState) -> AgentState:
    """Flags the conversation for Human-in-the-Loop intervention."""
    # In a real system, this would trigger a webhook to a human agent dashboard
    return {
        "answer": "I understand you need more specific help. I have paused my automated responses and alerted a human support agent. They will join this chat shortly.",
        "sources": [],
        "needs_human": True # This triggers the HITL state
    }


def rag_node(state: AgentState) -> AgentState:
    """Retrieves context and generates a grounded response."""
    query = state["question"]
    target_file = state.get("target_file")
    
    # Retrieve
    query_embedding = embedder.encode([query]).tolist()
    where_filter = {"filename": target_file} if target_file else None
    
    results = collection.query(
        query_embeddings=query_embedding, 
        n_results=4,
        where=where_filter
    )
    chunks = results.get("documents", [[]])[0]
    
    if not chunks:
        return {
            "answer": "I'm sorry, I don't have information regarding that in my knowledge base. Would you like me to connect you to a human agent?", 
            "sources": [],
            "needs_human": False
        }

    # Generate
    context = "\n\n---\n\n".join(chunks)
    system_prompt = (
        "You are a polite, professional Customer Support Assistant. "
        "Answer the user's question ONLY based on the provided context. "
        "If the answer is not in the context, politely state that you do not know and offer to connect them to an agent. "
        "Do not hallucinate."
    )

    user_message = f"Context:\n{context}\n\nQuestion: {query}"

    response = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.2,
    )

    return {"answer": response.choices[0].message.content, "sources": chunks, "needs_human": False}

# --- 4. Define Edge Logic (The Router) ---
def route_to_next(state: AgentState):
    """Decides which node to run next based on intent."""
    intent = state["intent"]
    if intent == "greeting":
        return "greeting_node"
    elif intent == "escalate":
        return "hitl_escalation_node"
    else:
        return "rag_node"

# --- 5. Build the LangGraph ---
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("router", router_node)
workflow.add_node("greeting_node", greeting_node)
workflow.add_node("hitl_escalation_node", hitl_escalation_node)
workflow.add_node("rag_node", rag_node)

# Set entry point
workflow.set_entry_point("router")

# Add conditional edges from router
workflow.add_conditional_edges(
    "router",
    route_to_next,
    {
        "greeting_node": "greeting_node",
        "hitl_escalation_node": "hitl_escalation_node",
        "rag_node": "rag_node"
    }
)

# All processing nodes end the workflow
workflow.add_edge("greeting_node", END)
workflow.add_edge("hitl_escalation_node", END)
workflow.add_edge("rag_node", END)

# Compile the graph
app_graph = workflow.compile()

# --- 6. Expose the Ask Function for main.py ---
def ask(query: str, target_file: str = None) -> dict:
    # Initialize the state
    initial_state = {
        "question": query,
        "target_file": target_file,
        "intent": "",
        "answer": "",
        "sources": [],
        "needs_human": False
    }
    
    # Run the graph
    result = app_graph.invoke(initial_state)
    
    return {
        "answer": result["answer"], 
        "sources": result["sources"],
        "needs_human": result["needs_human"]
    }