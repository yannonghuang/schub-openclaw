// pages/_app.tsx
import "../styles/globals.css";
import { Toaster } from "react-hot-toast";
import type { AppProps } from "next/app";
import { AuthProvider } from "../context/AuthContext";
import NavBar from "../components/NavBar";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <NavBar />  {/* Now NavBar appears on every page */}
      <Component {...pageProps} />
      <Toaster position="top-center" />
    </AuthProvider>
  );
}
