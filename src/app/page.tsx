import fs from "fs";
import path from "path";
import Link from "next/link";

/**
 * Brand New Minimalist Figma-Style Landing Page (`/`).
 * 
 * WHAT: Renders the blocky pixel title ("DUAL"), description line, ASCII art character-for-character,
 * and a bold red "Get Started" button navigating to `/player`.
 * 
 * WHY: Provides a striking, sharp entry point to the application with zero emojis and sharp grid styling.
 */
export default async function LandingPage() {
  // Read ascii-art (1).txt server-side to guarantee exact, unaltered character-for-character rendering
  const asciiPath = path.join(process.cwd(), "public", "ascii-art (1).txt");
  let asciiContent = "";
  try {
    asciiContent = fs.readFileSync(asciiPath, "utf-8");
  } catch (err) {
    console.error("Failed reading ASCII art file:", err);
  }

  return (
    <main className="min-h-screen bg-[#f5f0eb] text-[#1c1917] flex flex-col items-center justify-center p-6 selection:bg-[#dc2626] selection:text-white">
      <div className="max-w-4xl w-full flex flex-col items-center text-center space-y-6 border border-[#d4c8bc] bg-[#eae3db] p-8 md:p-12 shadow-[4px_4px_0px_0px_#1c1917]">
        
        {/* Pixel Header with floating animation */}
        <h1 
          className="text-6xl md:text-8xl font-bold tracking-tight text-[#dc2626] animate-float"
          style={{ fontFamily: "var(--font-pixelify), var(--font-silkscreen), monospace" }}
        >
          DUAL
        </h1>

        {/* Short Plain Description Line */}
        <p className="text-sm md:text-base font-medium text-[#78716c] uppercase tracking-wider">
          Play two songs at once — one for each ear.
        </p>

        {/* ASCII Art rendered character-for-character */}
        {asciiContent && (
          <div className="w-full overflow-x-auto bg-[#1c1917] p-4 md:p-6 border border-[#1c1917] my-4 shadow-[2px_2px_0px_0px_#dc2626]">
            <pre 
              className="text-[#dc2626] font-mono text-[6px] sm:text-[8px] md:text-[10px] leading-[1.0] select-none mx-auto inline-block text-left"
              style={{ fontFamily: "monospace", whiteSpace: "pre" }}
            >
              {asciiContent}
            </pre>
          </div>
        )}

        {/* Get Started Button */}
        <Link
          href="/player"
          className="inline-block px-8 py-3.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-sm tracking-wider uppercase border border-[#1c1917] shadow-[3px_3px_0px_0px_#1c1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#1c1917] transition-all"
        >
          Get Started
        </Link>
      </div>
    </main>
  );
}
