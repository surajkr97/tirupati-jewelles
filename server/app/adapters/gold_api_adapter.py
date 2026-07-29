import requests
from datetime import datetime

TROY_OUNCE_IN_GRAMS = 31.1034768

USD_TO_INR = 95.75

METAL_SYMBOLS = {
    "gold": "XAU",
    "silver": "XAG",
}


class GoldApiAdapter:
    def __init__(self, base_url: str = "https://api.gold-api.com"):
        self.base_url = base_url
        self.session = requests.Session()

    def fetch_pure_rate(self, metal: str) -> dict:
        if metal not in METAL_SYMBOLS:
            raise ValueError(
                f"Unknown metal '{metal}', expected one of {list(METAL_SYMBOLS)}"
            )

        symbol = METAL_SYMBOLS[metal]
        url = f"{self.base_url}/price/{symbol}/USD"

        try:
            response = self.session.get(url, timeout=10)
        except requests.RequestException as exc:
            raise RuntimeError(
                f"Failed to reach gold-api.com for {metal}: {exc}"
            ) from exc

        if response.status_code != 200:
            raise RuntimeError(
                f"gold-api.com returned {response.status_code} for {metal}: {response.text}"
            )

        data = response.json()

        price_per_troy_ounce_usd = data["price"]
        price_per_troy_ounce_inr = price_per_troy_ounce_usd * USD_TO_INR
        pure_rate_per_gram = price_per_troy_ounce_inr / TROY_OUNCE_IN_GRAMS

        recorded_at = datetime.fromisoformat(data["updatedAt"].replace("Z", "+00:00"))

        return {
            "metal": metal,
            "pure_rate_per_gram": pure_rate_per_gram,
            "recorded_at": recorded_at,
        }

    def fetch_all_rates(self) -> list[dict]:
        return [
            self.fetch_pure_rate("gold"),
            self.fetch_pure_rate("silver"),
        ]


if __name__ == "__main__":
    adapter = GoldApiAdapter()

    gold = adapter.fetch_pure_rate("gold")
    print("Gold:", gold)

    silver = adapter.fetch_pure_rate("silver")
    print("Silver:", silver)

    both = adapter.fetch_all_rates()
    print("Both:", both)
