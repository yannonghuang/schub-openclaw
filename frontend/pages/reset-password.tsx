import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import { useState, useEffect } from "react";
//import { resetPassword } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import AuthLayout from "../components/AuthLayout";
import { KeyIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { serverSideTranslations } from "next-i18next/pages/serverSideTranslations";

export async function getStaticProps({ locale }: { locale: string }) {
  return { props: { ...(await serverSideTranslations(locale, ["common", "auth"])) } };
}

import Link from "next/link";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { resetPassword } = useAuth();

  type FormValues = {
    resetToken: string;
    newPassword: string;
  };

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm();

  // when `?token=XYZ` appears in the URL, populate the form
  useEffect(() => {
    if (typeof router.query.token === "string") {
      setValue("resetToken", router.query.token);
    }
  }, [router.query.token, setValue]);

  const onSubmit = async (data: FormValues) => {
    try {
      setLoading(true);
      await resetPassword({ token: data.resetToken, newPassword: data.newPassword });
      toast.success("Password reset!");
      router.push("/signin");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err.message || "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <h2 style={{ textAlign: "center", fontSize: "1.5rem", fontWeight: "700", marginBottom: "1rem" }}>
        Reset Password
      </h2>
      <form onSubmit={handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div className="input-wrapper">
          <span className="input-icon"><KeyIcon /></span>
          <input
            type="text"
            placeholder="Reset Token"
            {...register("resetToken", { required: true })}
            className={errors.resetToken ? "error" : ""}
            autoComplete="off"
          />
          {errors.resetToken && <p className="error-text">Reset token is required</p>}
        </div>

        <div className="input-wrapper">
          <span className="input-icon"><LockClosedIcon /></span>
          <input
            type="password"
            placeholder="New Password"
            {...register("newPassword", { required: true })}
            className={errors.newPassword ? "error" : ""}
            autoComplete="new-password"
          />
          {errors.newPassword && <p className="error-text">New password is required</p>}
        </div>

        <button type="submit" disabled={loading}>
          {loading ? "Resetting..." : "Reset Password"}
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
