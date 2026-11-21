import { memo, useEffect, useRef, useState } from "react";
import { currentTheme } from "../ui/kit.tsx";
import { currentAccent } from "../ui/accent.ts";
import { accentOf } from "../../shared/accents.ts";

/**
 * TradingView "Symbol Overview" embed. Market data and charts come from TradingView;
 * their attribution link must stay. Re-created when Folio switches between light and dark.
 */
// The person's own symbols (TradingView "EXCHANGE:SYMBOL"); the chart follows Folio's light/dark mode and accent.
function TradingViewWidget({ symbols }: { symbols: string[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState(currentTheme);
  const [accent, setAccent] = useState(currentAccent);

  useEffect(() => {
    const update = () => { setTheme(currentTheme()); setAccent(currentAccent()); };
    const mq = matchMedia("(prefers-color-scheme: dark)");
    addEventListener("folio:theme", update);
    addEventListener("folio:accent", update);
    mq.addEventListener("change", update);
    return () => { removeEventListener("folio:theme", update); removeEventListener("folio:accent", update); mq.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    const host = container.current?.querySelector(".tradingview-widget-container__widget");
    if (!host) return;
    const dark = theme === "dark";
    const a = accentOf(accent), line = dark ? a.dark : a.light;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      lineWidth: 2,
      lineType: 0,
      chartType: "area",
      lineColor: line,
      topColor: `${line}55`,
      bottomColor: `${line}00`,
      fontColor: dark ? "rgb(106, 109, 120)" : "rgb(110, 110, 115)",
      gridLineColor: dark ? "rgba(242, 242, 242, 0.06)" : "rgba(0, 0, 0, 0.06)",
      volumeUpColor: "rgba(34, 171, 148, 0.5)",
      volumeDownColor: "rgba(247, 82, 95, 0.5)",
      backgroundColor: dark ? "#0F0F0F" : "#FFFFFF",
      widgetFontColor: dark ? "#DBDBDB" : "#1D1D1F",
      upColor: "#22ab94",
      downColor: "#f7525f",
      borderUpColor: "#22ab94",
      borderDownColor: "#f7525f",
      wickUpColor: "#22ab94",
      wickDownColor: "#f7525f",
      colorTheme: dark ? "dark" : "light",
      isTransparent: true,
      locale: "en",
      chartOnly: true,
      scalePosition: "right",
      scaleMode: "Normal",
      fontFamily: "-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif",
      valuesTracking: "1",
      changeMode: "price-and-percent",
      symbols: symbols.map((s) => [s]),
      dateRanges: ["1d|1", "1m|30", "3m|60", "12m|1D", "60m|1W", "all|1M"],
      fontSize: "10",
      headerFontSize: "medium",
      autosize: true,
      width: "100%",
      height: "100%",
      noTimeScale: false,
      hideDateRanges: false,
    });
    host.appendChild(script);
    // Clean up fully so a theme change (or React's dev double-mount) leaves one widget, not two.
    return () => { host.innerHTML = ""; };
  }, [theme, accent, symbols.join(",")]);

  return (
    <div className="tradingview-widget-container" ref={container}>
      <div className="tradingview-widget-container__widget"></div>
      <div className="tradingview-widget-copyright">
        {symbols.slice(0, 3).map((s, i) => (
          <span key={s}>{i > 0 && <span className="and">{i === symbols.length - 1 || i === 2 ? " and " : ", "}</span>}
            <a href={`https://www.tradingview.com/symbols/${s.replace(":", "-")}/`} rel="noopener nofollow" target="_blank"><span className="blue-text">{s.split(":").pop()}</span></a></span>
        ))}
        <span className="trademark">&nbsp;{symbols.length > 3 ? "and more " : ""}by TradingView</span>
      </div>
    </div>
  );
}

export default memo(TradingViewWidget);
