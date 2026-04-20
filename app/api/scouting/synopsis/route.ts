import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { prospectName, position, totalPlays, notes } =
    (await req.json()) as {
      prospectName: string;
      position: string;
      totalPlays: number;
      notes: string[];
    };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  if (notes.length === 0) {
    return NextResponse.json({ synopsis: "No play notes recorded yet." });
  }

  const notesBlock = notes.map((n, i) => `${i + 1}. ${n}`).join("\n");

  const prompt = `You are a football scout reviewing your own play notes for a ${position} prospect named ${prospectName}.

Total plays charted: ${totalPlays}
Notes recorded on ${notes.length} plays:
${notesBlock}

Summarize these notes in 3-5 sentences. Identify recurring themes and patterns — if something comes up multiple times, call it out specifically. Use natural language, this is a quick personal reminder of what you observed, not a formal report. Do not invent anything not in the notes. Do not include a title or header, start directly with the summary.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: 500 });
  }

  const data = (await res.json()) as { content: { type: string; text: string }[] };
  const synopsis = data.content.find((c) => c.type === "text")?.text ?? "";
  return NextResponse.json({ synopsis });
}
