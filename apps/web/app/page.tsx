async function getApiStatus(): Promise<string> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${apiUrl}/health`, { cache: "no-store" });
    if (!res.ok) return "unreachable";
    const data = (await res.json()) as { status: string };
    return data.status;
  } catch {
    return "unreachable";
  }
}

export default async function Home() {
  const apiStatus = await getApiStatus();

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
      <h1>IBMS</h1>
      <p>Insurance Brokerage Management System — scaffold.</p>
      <p>
        API status: <strong>{apiStatus}</strong>
      </p>
    </main>
  );
}
