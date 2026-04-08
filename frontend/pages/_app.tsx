// pages/_app.tsx
import "../styles/globals.css";
import { Toaster } from "react-hot-toast";
import type { AppProps } from "next/app";
import { appWithTranslation } from "next-i18next/pages";
import { AuthProvider } from "../context/AuthContext";
import { AgentPanelProvider } from "../context/AgentPanelContext";
import { LocaleProvider } from "../context/LocaleContext";
import NavBar from "../components/NavBar";
import MultiThread from "../components/BusinessNetwork/MultiThread";
import AgentFAB from "../components/AgentFAB";

function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <LocaleProvider>
        <AgentPanelProvider>
          <NavBar />
          <Component {...pageProps} />
          <Toaster position="top-center" />
          <AgentFAB />
          <MultiThread />
        </AgentPanelProvider>
      </LocaleProvider>
    </AuthProvider>
  );
}

export default appWithTranslation(App);
