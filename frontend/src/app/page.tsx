"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ShieldCheck, Handshake, RefreshCw, Award, MapPin } from "lucide-react";
import {
  GiNecklace,
  GiBigDiamondRing,
  GiCrystalEarrings,
  GiCircleClaws,
  GiGemPendant,
} from "react-icons/gi";

interface RateOut {
  metal: string;
  purity: string;
  rate: number;
  change: number;
  recorded_at: string;
}

interface RatePoint {
  rate: number;
  recorded_at: string;
}

interface RateHistory {
  metal: string;
  purity: string;
  trend: string;
  points: RatePoint[];
}

const KARAT_LABELS: Record<string, string> = {
  "999": "24 Karat",
  "916": "22 Karat",
  "750": "18 Karat",
  "585": "14 Karat",
};

const CATEGORIES = [
  { name: "Necklaces", Icon: GiNecklace },
  { name: "Earrings", Icon: GiCrystalEarrings },
  { name: "Bangles", Icon: GiCircleClaws },
  { name: "Rings", Icon: GiBigDiamondRing },
  { name: "Pendants", Icon: GiGemPendant },
];

const TRUST_BADGES = [
  { Icon: ShieldCheck, line1: "100%", line2: "Hallmarked" },
  { Icon: Handshake, line1: "Best Making", line2: "Charges" },
  { Icon: RefreshCw, line1: "Easy", line2: "Exchange" },
  { Icon: Award, line1: "Buyback", line2: "Guarantee" },
];

function openInGoogleMaps() {
  const url = `https://maps.app.goo.gl/jfoohqU9hHxEu15V8`;
  window.open(url, "_blank", "noopener,noreferrer");
}

const WHATSAPP_NUMBER = "919507769218";

function openWhatsApp(message: string) {
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

const BANNER_IMAGES = ["/ban1.png", "/ban2.png", "/ban3.png", "/ban4.png"];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function HeroBanner() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActive((prev) => (prev + 1) % BANNER_IMAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="mx-4 mt-4 rounded-3xl overflow-hidden relative h-56 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(180,140,70,0.12)]">
      {BANNER_IMAGES.map((src, i) => (
        <div
          key={src}
          className={`absolute inset-0 transition-opacity duration-700 ${i === active ? "opacity-100" : "opacity-0"}`}
        >
          <Image
            src={src}
            alt={`Banner ${i + 1}`}
            fill
            sizes="(max-width: 448px) 100vw, 448px"
            className="object-cover"
            priority={i === 0}
          />
        </div>
      ))}

      <div className="absolute inset-0 bg-linear-to-r from-black/55 via-black/25 to-transparent" />

      <div className="relative z-10 h-full flex flex-col justify-center p-6 max-w-[70%]">
        <h2 className="font-display text-2xl leading-snug mb-2 text-white">
          Timeless Beauty
          <br />
          Crafted for You
        </h2>
        <p className="text-sm text-white/90 mb-2">
          Discover our exclusive collection
        </p>
        <button
          onClick={() =>
            openWhatsApp(
              "नमस्ते! मुझे आपकी ज्वेलरी कलेक्शन कलेक्शन में रुचि है। कृपया और जानकारी साझा करें।",
            )
          }
          className="bg-[#B98A4A] hover:bg-[#a67a3f] transition-colors text-white text-sm font-medium tracking-wide px-5 py-2.5 rounded-lg w-fit shadow-sm cursor-pointer"
        >
          Explore Collection
        </button>
      </div>

      <div className="absolute bottom-5 left-7 flex gap-1.5 z-10">
        {BANNER_IMAGES.map((_, i) => (
          <button
            key={i}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => setActive(i)}
            className={`h-1.5 rounded-full transition-all ${i === active ? "w-5 bg-white" : "w-1.5 bg-white/50 hover:bg-white/70"}`}
          />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const [liveRates, setLiveRates] = useState<RateOut[]>([]);
  const [silverHistory, setSilverHistory] = useState<RateHistory | null>(null);
  const [loading, setLoading] = useState(true);

useEffect(() => {
  async function fetchData() {
    try {
      const [liveRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/rates/live`),
        fetch(`${API_BASE}/rates/history?metal=silver&purity=999&hours=24`),
      ]);
      setLiveRates(await liveRes.json());
      setSilverHistory(await historyRes.json());
    } catch (err) {
      console.error("Failed to load rates:", err);
    } finally {
      setLoading(false);
    }
  }

  fetchData();
  const interval = setInterval(fetchData, 30000);
  return () => clearInterval(interval);
}, []);

  const goldRates = liveRates.filter((r) => r.metal === "gold");
  const silverRate = liveRates.find((r) => r.metal === "silver");

  const lastUpdated = liveRates[0]
    ? new Date(liveRates[0].recorded_at).toLocaleString("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <main className="max-w-md mx-auto bg-[#FBF8F3] min-h-screen">
      <header className="flex items-center justify-between px-5 py-4 border-b border-[#EDE4D3]">
        <button
          aria-label="Menu"
          className="w-9 h-9 flex items-center justify-center rounded-full border border-[#EDE4D3] text-gray-900 hover:bg-white transition-colors"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <div className="text-center">
          <h1 className="font-display text-xl tracking-wide text-gray-900">
            TIRUPATI
          </h1>
          <p className="text-[11px] tracking-[0.35em] text-amber-700 -mt-1">
            JEWELLES
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="tel:+919507769218"
            aria-label="Call"
            className="w-9 h-9 flex items-center justify-center rounded-full border border-[#EDE4D3] text-gray-900 hover:bg-white transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <path d="M2 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L12 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 5a2 2 0 0 1 2-2z" />
            </svg>
          </a>
          {/* <button
            aria-label="Notifications"
            className="w-9 h-9 flex items-center justify-center rounded-full border border-[#EDE4D3] text-gray-900 hover:bg-white transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <path d="M9 18a2 2 0 0 0 4 0M4 15h14l-1.5-2V9a5.5 5.5 0 0 0-11 0v4L4 15z" />
            </svg>
          </button> */}
          <button
            aria-label="Store location"
            onClick={openInGoogleMaps}
            className="w-9 h-9 flex items-center justify-center rounded-full border border-[#EDE4D3] text-gray-900 hover:bg-white transition-colors cursor-pointer"
          >
            <MapPin size={16} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <HeroBanner />

      <section className="mx-4 mt-4 bg-white rounded-2xl border border-[#EDE4D3] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_12px_rgba(0,0,0,0.03)] p-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm tracking-wide text-gray-900">
            LIVE GOLD & SILVER PRICE
          </p>
          <span className="flex items-center gap-1.5 text-xs text-green-700 font-medium bg-green-50 px-2.5 py-1 rounded-full">
            <span className="relative flex w-1.5 h-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-900 opacity-75" />
              <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-green-500" />
            </span>
            LIVE
          </span>
        </div>
        <div className="flex items-center justify-between mt-2 mb-4 pb-3 border-b border-[#F1E9D8]">
          <p className="text-xs text-gray-500">{lastUpdated}</p>
          <p className="text-xs text-gray-500">Prices update automatically</p>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            Loading live rates…
          </p>
        ) : (
          <div className="grid grid-cols-[11fr_9fr] gap-3">
            <div className="flex flex-col h-full">
              <p className="text-xs font-semibold text-amber-700 mb-2 tracking-wide">
                GOLD (₹/10 Gram)
              </p>
              <div className="bg-amber-50/60 rounded-xl divide-y divide-amber-100/70 border border-amber-100/70">
                {goldRates.map((r) => (
                  <div
                    key={r.purity}
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-amber-50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {KARAT_LABELS[r.purity]}
                      </p>
                      <p className="text-[10px] text-gray-500">({r.purity})</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">
                        ₹{r.rate.toLocaleString("en-IN")}
                      </p>
                      <p
                        className={`text-[11px] font-medium ${r.change >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {r.change >= 0 ? "▲" : "▼"} {Math.abs(r.change)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col h-full">
              <p className="text-xs font-semibold text-gray-500 mb-2 tracking-wide">
                SILVER (₹/Kg)
              </p>
              <div className="bg-gray-50/70 rounded-xl border border-gray-100 p-3 flex-1 flex flex-col">
                {silverRate && (
                  <>
                    <p className="text-xl font-semibold text-gray-900 text-center">
                      ₹{silverRate.rate.toLocaleString("en-IN")}
                    </p>
                    <p
                      className={`text-xs font-medium text-center ${silverRate.change >= 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {silverRate.change >= 0 ? "▲" : "▼"}{" "}
                      {Math.abs(silverRate.change)}
                    </p>
                  </>
                )}
                <div className="flex-1 my-2">
                  <Sparkline
                    points={silverHistory?.points ?? []}
                    trend={silverHistory?.trend}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-gray-500">
                    Today&apos;s Trend
                  </p>
                  <span className="text-[10px] font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
                    {silverHistory?.trend ?? "flat"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="mx-4 mt-4 bg-white rounded-2xl border border-[#EDE4D3] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_12px_rgba(0,0,0,0.03)] px-2 py-4 flex justify-between text-center">
        {TRUST_BADGES.map(({ Icon, line1, line2 }) => (
          <div
            key={line1}
            className="flex-1 px-1 flex flex-col items-center gap-1.5"
          >
            <div className="w-9 h-9 flex items-center justify-center rounded-full bg-amber-50">
              <Icon size={17} className="text-amber-700" strokeWidth={1.75} />
            </div>
            <p className="text-[10px] text-gray-600 leading-tight text-center">
              {line1}
              <br />
              {line2}
            </p>
          </div>
        ))}
      </section>

      <section className="mx-4 mt-5 mb-8">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-sm text-gray-900">
            Shop by Category
          </p>
          <button
            onClick={() =>
              openWhatsApp(
                "नमस्ते! मुझे आपकी ज्वेलरी कलेक्शन कलेक्शन में रुचि है। कृपया और जानकारी साझा करें।",
              )
            }
            className="text-xs text-amber-700 font-medium cursor-pointer"
          >
            View All &gt;
          </button>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {CATEGORIES.map(({ name, Icon }) => (
            <div
              key={name}
              onClick={() =>
                openWhatsApp(
                  `नमस्ते! मुझे आपकी ${name} कलेक्शन में रुचि है। कृपया और जानकारी साझा करें।`,
                )
              }
              className="flex flex-col items-center shrink-0 w-16 group cursor-pointer"
            >
              <div className="w-16 h-16 rounded-full bg-amber-50 border border-amber-100 shadow-[0_1px_2px_rgba(0,0,0,0.03)] group-hover:border-amber-300 transition-colors flex items-center justify-center">
                <Icon size={26} className="text-amber-700" />
              </div>
              <p className="text-[11px] text-gray-700 mt-1.5">{name}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Sparkline({ points, trend }: { points: RatePoint[]; trend?: string }) {
  if (points.length < 2) {
    return (
      <div className="text-[10px] text-gray-300 text-center pt-4">
        Not enough data yet
      </div>
    );
  }

  const rates = points.map((p) => p.rate);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const range = max - min || 1;
  const width = 140;
  const height = 50;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p.rate - min) / range) * height;
    return `${x},${y}`;
  });

  const lineColor = trend === "falling" ? "#dc2626" : "#16a34a";
  const areaPoints = `0,${height} ${coords.join(" ")} ${width},${height}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
      <defs>
        <linearGradient id="sparklineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#sparklineFill)" />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}