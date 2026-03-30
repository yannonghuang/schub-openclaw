// pages/_app.tsx
import "../styles/globals.css";
import { Toaster } from "react-hot-toast";
import type { AppProps } from "next/app";
import { AuthProvider } from "../context/AuthContext";
import { AgentPanelProvider } from "../context/AgentPanelContext";
import NavBar from "../components/NavBar";
import MultiThread from "../components/BusinessNetwork/MultiThread";
import AgentFAB from "../components/AgentFAB";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <AgentPanelProvider>
        <NavBar />
        <Component {...pageProps} />
        <Toaster position="top-center" />
        <AgentFAB />
        <MultiThread />
      </AgentPanelProvider>
    </AuthProvider>
  );
}
