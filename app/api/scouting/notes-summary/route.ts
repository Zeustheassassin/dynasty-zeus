import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { notes, totalPlays, position } = (await req.json()) as {
    notes: string[];
    totalPlays: number;
    position: string;
  };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  if (!notes || notes.length === 0) {
    return NextResponse.json({ summary: "No notes found to analyze." });
  }

  const notesText = notes.map((n, i) => `${i + 1}. ${n}`).join("\n");

  const prompt = `You are a professional NFL draft scout analyzing play-by-play notes for a ${position} prospect.

Total plays observed: ${totalPlays}
Plays with notes recorded: ${notes.length}

Scout's notes:
${notesText}

Identify recurring patterns and behaviors in these notes. Write a concise scouting summary (3-5 sentences) where each notable pattern is expressed with an approximate percentage frequency based on the plays with notes vs. total plays observed. Use natural, professional scouting language. For example: "Showed hand-fighting issues on approximately 23% of routes, frequently getting clap-attacked at the release point" or "Demonstrated effort concerns, visibly slowing down or falling on 12% of observed plays." Only mention patterns that appear meaningfully (2+ occurrences). Be specific and analytical, not generic. Do not invent observations — only summarize what is actually written in the notes.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: 500 });
  }

  const data = (await res.json()) as { content: { type: string; text: string }[] };
  const summary = data.content.find((c) => c.type === "text")?.text ?? "";
  return NextResponse.json({ summary });
}
