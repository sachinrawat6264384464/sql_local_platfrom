import os
import sys

# Ensure local libs folder is searched first
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'libs'))

import google.generativeai as genai

api_key = os.getenv("GEMINI_API_KEY")
print(f"API Key Found: {api_key[:8]}...{api_key[-8:] if len(api_key) > 8 else ''}")

try:
    genai.configure(api_key=api_key)
    print("Listing models...")
    models = list(genai.list_models())
    print("\n--- Available Models for Generation ---")
    for m in models:
        if 'generateContent' in m.supported_generation_methods:
            print(f"- {m.name} (supports generateContent)")
except Exception as e:
    print(f"\nError occurred: {e}")
