import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AudioWeb STT",
  description: "Local audio transcription with FastAPI and faster-whisper.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
