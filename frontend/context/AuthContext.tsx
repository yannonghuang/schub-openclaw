// context/AuthContext.tsx
import { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";
import { useRouter } from "next/router";
import toast from "react-hot-toast";

type User = {
  id: string;
  email: string;
  fullName?: string;
  business?: {
    id: number; //string;
    name: string;
    location?: {
      id: number; //string;
      name: string;      
    }
  };
  role?: string;
};

type SignUpPayload = {
  email: string;
  password: string;
  full_name: string;
  business?: { name: string } | null;
  business_id?: number | null;
  token?: string | null;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  frontendUrl: string;
  isSystem: () => boolean;
  signUp: (payload: SignUpPayload) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{reset_token: string}> //<void>;
  resetPassword: (data: { token: string; newPassword: string }) => Promise<void>;
  inviteUser: (businessId: number, email: string) => Promise<void>;
  deleteUser: (businessId: number, userId: number) => Promise<void>;
  listUsers:  (businessId: number) => Promise<any>;
  updateUser: (businessId: number, userId: number, updates: any) => Promise<any>;
};


//var frontendUrl = process.env.NEXT_PUBLIC_frontendUrl || "https://localhost";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [frontendUrl, setFrontendUrl] = useState("");
  const router = useRouter();

  useEffect(() => {
    // Try to restore session on mount
    (async () => {
      try {
        const { data } = await axios.get(`/auth/me`);
        setUser(data.user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    // This code will only run on the client-side
    setFrontendUrl(window.location.protocol + '//' + window.location.host);
    //console.log("dynamic load frontendUrl: " + frontendUrl);
  }, []); // Empty dependency array ensures it runs once after initial render

  const isSystem = () => (user?.business?.name === "system");

  const signUp = async (payload: SignUpPayload) => {
    const { data } = await axios.post(`/auth/signup`, payload);
    setUser(data.user);
  };

  const signIn = async (email: string, password: string) => {
    const { data } = await axios.post(`/auth/signin`, { username: email, password });
    setUser(data.user);
  };

  const signOut = async () => {
    await axios.post(`/auth/signout`);
    setUser(null);
    router.push("/signin");
  };

  const forgotPassword = async (email: string ) => {
    const res = await axios.post(`/auth/forgot-password`, { email, url: frontendUrl });
    return res.data;
  }

  const resetPassword = async (data: { token: string; newPassword: string }) => {
    const res = await axios.post(`/auth/reset-password`, {
      token: data.token,
      new_password: data.newPassword,
    });
    return res.data;
  }

  const inviteUser = async (businessId: number, email: string) => {
    const res = await axios.post(`/business/${businessId}/invite`, {
      email: email, signup_url: frontendUrl,
    });
    return res.data;
  };

  const deleteUser = async (businessId: number, userId: number) => {
    if (!confirm("Remove this user?")) return;
    try {
      const res = await axios.delete(`/business/${businessId}/users/${userId}`);
      return res.data;
    } catch (e) {
      toast.error(e.message);
      throw e;
    }
  };

  const listUsers = async (businessId: number) => {
    const res = await axios.get(`/business/${businessId}/users`);
    return res.data;
  };

  const updateUser = async (businessId: number, userId: number, updates: any) => {
    const res = await axios.put(`/business/${businessId}/users/${userId}`, updates);
    return res.data;
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, frontendUrl, isSystem, signUp, signIn, signOut, forgotPassword, resetPassword, inviteUser, deleteUser, listUsers, updateUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

