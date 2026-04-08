import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { useState } from "react";
//import { forgotPassword } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import AuthLayout from "../components/AuthLayout";
import { EnvelopeIcon } from "@heroicons/react/24/outline";
import { serverSideTranslations } from "next-i18next/pages/serverSideTranslations";

export async function getStaticProps({ locale }: { locale: string }) {
  return { props: { ...(await serverSideTranslations(locale, ["common", "auth"])) } };
}

import Link from "next/link";

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const { forgotPassword } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  const onSubmit = async (data: any) => {
    try {
      setLoading(true);
      const result = await forgotPassword(data.email);
      toast.success(`Reset token sent. (Dev: ${result.reset_token})`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err.message || "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <h2 style={{ textAlign: "center", fontSize: "1.5rem", fontWeight: "700", marginBottom: "1rem" }}>
        Forgot Password
      </h2>
      <form onSubmit={handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div className="input-wrapper">
          <span className="input-icon"><EnvelopeIcon /></span>
          <input
            type="email"
            placeholder="you@example.com"
            {...register("email", { required: true })}
            className={errors.email ? "error" : ""}
            autoComplete="email"
          />
          {errors.email && <p className="error-text">Email is required</p>}
        </div>

        <button type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send Reset Link"}
        </button>

        <p style={{ fontSize: "0.875rem", textAlign: "center" }}>
          Remembered?{" "}
          <Link href="/signin" style={{ color: "#2563eb", textDecoration: "underline" }}>
            Sign In
          </Link>
        </p>
      </form>

      <style jsx>{`
        .input-wrapper {
          position: relative;
        }
        .input-icon {
          position: absolute;
          left: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          color: #9ca3af;
          width: 1.25rem;
          height: 1.25rem;
        }
        input {
          width: 100%;
          padding-left: 2.5rem;
          padding-right: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 1rem;
          height: 2.5rem;
          box-sizing: border-box;
        }
        input.error {
          border-color: #f87171;
        }
        .error-text {
          color: #f87171;
          font-size: 0.875rem;
          margin-top: 0.25rem;
        }
        button {
          width: 100%;
          background-color: #2563eb;
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 6px;
          border: none;
          font-weight: 600;
          cursor: pointer;
          height: 2.75rem;
          transition: background-color 0.2s ease;
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        button:not(:disabled):hover {
          background-color: #1e40af;
        }
      `}</style>
    </AuthLayout>
  );
}
