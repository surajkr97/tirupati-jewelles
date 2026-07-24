from fastapi import FastAPI
from app.routes import rates
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://www.tirupatijewelles.com",
        "https://tirupati-jewelles.vercel.app"
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rates.router)


@app.get("/")
def read_root():
    return {"message": "Welcome to the Tirupati Jewelles API!"}


@app.get("/health")
async def health():
    return {"status": "ok"}
