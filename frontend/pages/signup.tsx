import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import { useState, useEffect } from "react";
import AuthLayout from "../components/AuthLayout";
import {
  EnvelopeIcon,
  LockClosedIcon,
  UserIcon,
  BuildingOfficeIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useTranslation } from "next-i18next/pages";
import { serverSideTranslations } from "next-i18next/pages/serverSideTranslations";

export async function getStaticProps({ locale }: { locale: string }) {
  return { props: { ...(await serverSideTranslations(locale, ["common", "auth"])) } };
}

export default function SignUpPage() {
  const { t } = useTranslation("auth");
  const { signUp } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [businessName, setBusinessName] = useState("");

  const businessId = router.query.businessId as string | undefined;
  const token = router.query.token as string | undefined;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      email: "",
      password: "",
      fullName: "",
      businessName: "",
      businessId: businessId || "",
      token: token || "",
      mode: businessId ? "join" : "create",
    },
  });

  const mode = watch("mode");

  // Load all businesses if not coming from invite
  useEffect(() => {
    if (!businessId) {
      fetch("/business")
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch businesses");
          return res.json();
        })
        .then((data) => setBusinesses(data))
        .catch((err) => {
          console.error("Error fetching businesses:", err);
          toast.error("Could not load businesses");
        });
    }
  }, [businessId]);

  // Invite flow → prefill businessId, token, and businessName
  useEffect(() => {
    if (businessId) {
      setValue("businessId", businessId);
      setValue("token", token);
      setValue("mode", "join");
      fetch(`/business/${businessId}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch business");
          return res.json();
        })
        .then((data) => {
          setBusinessName(data.name);
          setValue("businessName", data.name);
        })
        .catch((err) => {
          console.error("Error fetching invited business:", err);
          toast.error("Could not load invited business");
        });
    }
  }, [businessId, token, setValue]);

  const onSubmit = async (data: any) => {
    try {
      setLoading(true);
      console.log(
        `Submit: mode=${data.mode}, businessId=${data.businessId}, businessName=${data.businessName}`
      );
      await signUp({
        email: data.email,
        password: data.password,
        full_name: data.fullName,
        business_id: data.mode === "join" ? data.businessId : null,
        business:
          /*data.mode === "create" && */data.businessName
            ? { name: data.businessName }
            : null,
        token: data.token || null,
      });
      toast.success("Signup successful!");
      router.push("/");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-center text-xl font-bold mb-4">{t("signUp.title")}</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        {/* Hidden values */}
        <input type="hidden" {...register("token")} />
        <input type="hidden" {...register("mode")} />

        {/* Full name */}
        <div className="input-wrapper">
          <span className="input-icon">
            <UserIcon />
          </span>
          <input
            type="text"
            placeholder="Your full name"
            {...register("fullName", { required: true })}
            className={errors.fullName ? "error" : ""}
          />
          {errors.fullName && (
            <p className="error-text">Full name is required</p>
          )}
        </div>

        {/* Email */}
        <div className="input-wrapper">
          <span className="input-icon">
            <EnvelopeIcon />
          </span>
          <input
            type="email"
            placeholder="you@example.com"
            {...register("email", { required: true })}
            className={errors.email ? "error" : ""}
            autoComplete="email"
          />
          {errors.email && <p className="error-text">Email is required</p>}
        </div>

        {/* Password */}
        <div className="input-wrapper">
          <span className="input-icon">
            <LockClosedIcon />
          </span>
          <input
            type="password"
            placeholder="••••••••"
            {...register("password", { required: true })}
            className={errors.password ? "error" : ""}
            autoComplete="new-password"
          />
          {errors.password && <p className="error-text">Password is required</p>}
        </div>

        {/* Business choice */}
        {!businessId ? (
          <div>
            <label className="block mb-1 font-medium">Business</label>
            <select
              {...register("mode", { required: true })}
              className="border p-2 rounded w-full"
            >
              <option value="create">Create New Business</option>
              <option value="join">Join Existing Business</option>
            </select>
          </div>
        ) : (
          // Invite flow forces mode="join"
          <input type="hidden" value="join" {...register("mode")} />
        )}

        {/* If creating new business */}
        {mode === "create" && !businessId && (
          <div className="input-wrapper">
            <span className="input-icon">
              <BuildingOfficeIcon />
            </span>
            <input
              type="text"
              placeholder="New business name"
              {...register("businessName", { required: true })}
              className={errors.businessName ? "error" : ""}
            />
            {errors.businessName && (
              <p className="error-text">Business name is required</p>
            )}
          </div>
        )}

        {/* Business ID field */}
        {mode === "join" && (
          <>
            {businessId ? (
              // Invite flow: hidden ID
              <input
                type="hidden"
                {...register("businessId", { required: true })}
                value={businessId}
              />
            ) : (
              // Manual join: choose from list
              <div>
                <label className="block mb-1 font-medium">Select Business</label>
                <select
                  {...register("businessId", { required: true })}
                  className="border p-2 rounded w-full"
                >
                  <option value="">-- Choose a business --</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {errors.businessId && (
                  <p className="error-text">Business is required</p>
                )}
              </div>
            )}
          </>
        )}

        {/* Invite flow display name */}
        {businessId && (
          <div className="input-wrapper">
            <span className="input-icon">
              <BuildingOfficeIcon />
            </span>
            <input type="text" value={businessName} readOnly />
          </div>
        )}

        <button type="submit" disabled={loading}>
          {loading ? t("buttons.loading", { ns: "common" }) : t("signUp.submit")}
        </button>

        <p className="text-sm text-center">
          {t("signUp.alreadyHaveAccount")}{" "}
          <Link href="/signin" className="text-blue-600 underline">
            {t("signUp.signIn")}
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
        input,
        select {
          width: 100%;
          padding-left: 2.5rem;
          padding-right: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 1rem;
          height: 2.5rem;
          box-sizing: border-box;
        }
        input.error,
        select.error {
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
