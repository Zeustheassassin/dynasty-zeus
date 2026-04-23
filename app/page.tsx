"use client";
import { AppProviders } from "./providers/AppProviders";
import { AuthSection } from "./components/AuthSection";
import { MainLayout } from "./components/MainLayout";
import { HubRouter } from "./components/HubRouter";
import { useAppState } from "./hooks/useAppState";

export default function Home() {
  const { providerProps, authSectionProps, mainLayoutProps, hubRouterProps } = useAppState();
  return (
    <AppProviders {...providerProps}>
      <AuthSection {...authSectionProps} />
      <MainLayout {...mainLayoutProps}>
        <HubRouter {...hubRouterProps} />
      </MainLayout>
    </AppProviders>
  );
}
