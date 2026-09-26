import "../server/config";
for (const key of ["PROOFLAYER_API_URL", "PROOFLAYER_ACCESS_TOKEN"])
  console.log(
    `${key}: ${process.env[key] ? "configured" : "missing (fixture mode only)"}`,
  );
console.log(
  "Keys are read server-side. Live research requires a deployed Modal runtime (pnpm deploy:modal).",
);
