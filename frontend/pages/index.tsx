

// frontend/pages/index.tsx
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { serverSideTranslations } from "next-i18next/pages/serverSideTranslations";

export async function getStaticProps({ locale }: { locale: string }) {
  return { props: { ...(await serverSideTranslations(locale, ["common", "agent"])) } };
}

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.push("/signin");
  }, [router]);

  return null;
}

