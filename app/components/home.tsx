"use client";

require("../polyfill");

import { useEffect, useState } from "react";
import styles from "./home.module.scss";

import LoadingIcon from "../icons/three-dots.svg";
import { BrandIcon } from "./brand-icon";

import { getCSSVar, useMobileScreen } from "../utils";

import dynamic from "next/dynamic";
import { Path, ServiceProvider, SlotID } from "../constant";
import { ErrorBoundary } from "./error";

import { getISOLang, getLang } from "../locales";

import {
  HashRouter as Router,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { SideBar } from "./sidebar";
import { useAppConfig } from "../store/config";
import { AuthPage } from "./auth";
import { getClientConfig } from "../config/client";
import { getClientApi } from "../client/api";
import { useAccessStore } from "../store";
import clsx from "clsx";
import { initializeMcpSystem, isMcpEnabled } from "../mcp/actions";
import { getModelProvider } from "../utils/model";
import { showToast } from "./ui-lib";
import { CloudSyncBootstrap } from "./cloud-sync-bootstrap";

export function Loading(props: { noLogo?: boolean }) {
  return (
    <div className={clsx("no-dark", styles["loading-content"])}>
      {!props.noLogo && <BrandIcon />}
      <LoadingIcon />
    </div>
  );
}

const Artifacts = dynamic(async () => (await import("./artifacts")).Artifacts, {
  loading: () => <Loading noLogo />,
});

const Settings = dynamic(async () => (await import("./settings")).Settings, {
  loading: () => <Loading noLogo />,
});

const Chat = dynamic(async () => (await import("./chat")).Chat, {
  loading: () => <Loading noLogo />,
});

const NewChat = dynamic(async () => (await import("./new-chat")).NewChat, {
  loading: () => <Loading noLogo />,
});

const MaskPage = dynamic(async () => (await import("./mask")).MaskPage, {
  loading: () => <Loading noLogo />,
});

const PluginPage = dynamic(async () => (await import("./plugin")).PluginPage, {
  loading: () => <Loading noLogo />,
});

const SearchChat = dynamic(
  async () => (await import("./search-chat")).SearchChatPage,
  {
    loading: () => <Loading noLogo />,
  },
);

const Sd = dynamic(async () => (await import("./sd")).Sd, {
  loading: () => <Loading noLogo />,
});

const McpMarketPage = dynamic(
  async () => (await import("./mcp-market")).McpMarketPage,
  {
    loading: () => <Loading noLogo />,
  },
);

export function useSwitchTheme() {
  const config = useAppConfig();

  useEffect(() => {
    document.body.classList.remove("light");
    document.body.classList.remove("dark");

    if (config.theme === "dark") {
      document.body.classList.add("dark");
    } else if (config.theme === "light") {
      document.body.classList.add("light");
    }

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    if (config.theme === "auto") {
      metaDescriptionDark?.setAttribute("content", "#273033");
      metaDescriptionLight?.setAttribute("content", "#f7f9f9");
    } else {
      const themeColor = getCSSVar("--theme-color");
      metaDescriptionDark?.setAttribute("content", themeColor);
      metaDescriptionLight?.setAttribute("content", themeColor);
    }
  }, [config.theme]);
}

function useHtmlLang() {
  useEffect(() => {
    const lang = getISOLang();
    const htmlLang = document.documentElement.lang;

    if (lang !== htmlLang) {
      document.documentElement.lang = lang;
    }
  }, []);
}

const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

const loadAsyncGoogleFont = () => {
  const linkEl = document.createElement("link");
  const proxyFontUrl = "/google-fonts";
  const remoteFontUrl = "https://fonts.googleapis.com";
  const googleFontUrl =
    getClientConfig()?.buildMode === "export" ? remoteFontUrl : proxyFontUrl;
  linkEl.rel = "stylesheet";
  linkEl.href =
    googleFontUrl +
    "/css2?family=" +
    encodeURIComponent("Noto Sans:wght@300;400;700;900") +
    "&display=swap";
  document.head.appendChild(linkEl);
};

export function WindowContent(props: { children: React.ReactNode }) {
  return (
    <div className={styles["window-content"]} id={SlotID.AppBody}>
      {props?.children}
    </div>
  );
}

function Screen() {
  const config = useAppConfig();
  const location = useLocation();
  const isArtifact = location.pathname.includes(Path.Artifacts);
  const isHome = location.pathname === Path.Home;
  const isAuth = location.pathname === Path.Auth;
  const isSd = location.pathname === Path.Sd;
  const isSdNew = location.pathname === Path.SdNew;

  const isMobileScreen = useMobileScreen();
  const shouldTightBorder =
    getClientConfig()?.isApp || (config.tightBorder && !isMobileScreen);

  useEffect(() => {
    loadAsyncGoogleFont();
  }, []);

  if (isArtifact) {
    return (
      <Routes>
        <Route path="/artifacts/:id" element={<Artifacts />} />
      </Routes>
    );
  }
  const renderContent = () => {
    if (isAuth) return <AuthPage />;
    if (isSd) return <Sd />;
    if (isSdNew) return <Sd />;
    return (
      <>
        <SideBar
          className={clsx({
            [styles["sidebar-show"]]: isHome,
          })}
        />
        <WindowContent>
          <Routes>
            <Route path={Path.Home} element={<Chat />} />
            <Route path={Path.NewChat} element={<NewChat />} />
            <Route path={Path.Masks} element={<MaskPage />} />
            <Route path={Path.Plugins} element={<PluginPage />} />
            <Route path={Path.SearchChat} element={<SearchChat />} />
            <Route path={Path.Chat} element={<Chat />} />
            <Route path={Path.Settings} element={<Settings />} />
            <Route path={Path.McpMarket} element={<McpMarketPage />} />
          </Routes>
        </WindowContent>
      </>
    );
  };

  return (
    <div
      className={clsx(styles.container, {
        [styles["tight-container"]]: shouldTightBorder,
        [styles["rtl-screen"]]: getLang() === "ar",
      })}
    >
      {renderContent()}
    </div>
  );
}

export function useLoadData() {
  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      const accessStore = useAccessStore.getState();
      await accessStore.fetch();

      const providers = [
        ServiceProvider.OpenAI,
        ...(useAccessStore.getState().isCloudflare
          ? [ServiceProvider.Cloudflare]
          : []),
      ];
      const results = await Promise.all(
        providers.map(async (provider) => {
          try {
            return {
              models: await getClientApi(provider).llm.models(),
              error: undefined,
              provider,
            };
          } catch (error) {
            return { models: [], error, provider };
          }
        }),
      );
      if (cancelled) return;

      const models = results.flatMap((result) => result.models);
      const config = useAppConfig.getState();
      config.mergeModels(models);

      results.forEach(({ error, provider }) => {
        if (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(`[Models] failed to load ${provider} models`, error);
          showToast(`Failed to load ${provider} models: ${message}`);
        }
      });

      if (models.length === 0) {
        if (results.every((result) => !result.error)) {
          showToast("No models were returned by the configured providers.");
        }
        return;
      }

      const [defaultModel, defaultProvider] = getModelProvider(
        useAccessStore.getState().defaultModel,
      );
      const preferredModel =
        models.find(
          (model) =>
            model.name === defaultModel &&
            (!defaultProvider ||
              model.provider.providerName === defaultProvider),
        ) ?? models[0];
      const currentModelIsAvailable = models.some(
        (model) =>
          model.name === config.modelConfig.model &&
          model.provider.providerName === config.modelConfig.providerName,
      );

      if (!currentModelIsAvailable) {
        config.update((appConfig) => {
          appConfig.modelConfig.model = preferredModel.name;
          appConfig.modelConfig.providerName =
            preferredModel.provider.providerName as ServiceProvider;
        });
      }
    };

    loadModels().catch((error: Error) => {
      if (cancelled) return;
      console.error("[Models] failed to load from configured endpoint", error);
      useAppConfig.getState().mergeModels([]);
      showToast(
        `Failed to load models from the configured OpenAI-compatible endpoint: ${error.message}`,
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);
}

export function Home() {
  useSwitchTheme();
  useLoadData();
  useHtmlLang();

  useEffect(() => {
    console.log("[Config] got config from build time", getClientConfig());
    useAccessStore.getState().fetch();

    const initMcp = async () => {
      try {
        const enabled = await isMcpEnabled();
        if (enabled) {
          console.log("[MCP] initializing...");
          await initializeMcpSystem(useAccessStore.getState().accessCode);
          console.log("[MCP] initialized");
        }
      } catch (err) {
        console.error("[MCP] failed to initialize:", err);
      }
    };
    initMcp();
  }, []);

  if (!useHasHydrated()) {
    return <Loading />;
  }

  return (
    <>
      <CloudSyncBootstrap />
      <ErrorBoundary>
        <Router>
          <Screen />
        </Router>
      </ErrorBoundary>
    </>
  );
}
