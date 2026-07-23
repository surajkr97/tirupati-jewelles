from fastapi import FastAPI
from app.routes import rates
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rates.router)

@app.get("/health")
async def health():
    return {"status": "ok"}