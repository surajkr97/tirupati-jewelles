from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.routes.rates import router as rates_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://www.tirupatijewelles.com",
        "https://tirupati-jewelles.vercel.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    # Required for the browser to send/store the auth cookie on cross-origin
    # requests. Note this is incompatible with allow_origins=["*"] — the origin
    # list above must stay explicit.
    allow_credentials=True,
)

app.include_router(rates_router)
app.include_router(auth_router)


@app.get("/")
def read_root():
    return {"message": "Welcome to the Tirupati Jewelles API!"}


@app.get("/health")
async def health():
    return {"status": "ok"}
