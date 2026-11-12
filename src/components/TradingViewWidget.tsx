import { memo, useEffect, useRef, useState } from "react";
import { currentTheme } from "../ui/kit.tsx";

/**
 * TradingView "Symbol Overview" embed. Market data and charts come from TradingView;
 * their attribution link must stay. Re-created when Folio switches between light and dark.
 */
// TradingView's free embeds refuse NSE symbols (exchange licensing); the BSE listings of the same companies chart fine.
function TradingViewWidget({ symbols = [["BSE:APOLLO|1M"], ["BSE:PERSISTENT|1D"]] }: { symbols?: string[][] }) {
  const container = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    const update = () => setTheme(currentTheme());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    addEventListener("folio:theme", update);
    mq.addEventListener("change", update);
    return () => { removeEventListener("folio:theme", update); mq.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    const host = container.current?.querySelector(".tradingview-widget-container__widget");
    if (!host) return;
    const dark = theme === "dark";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      lineWidth: 2,
      lineType: 0,
      chartType: "area",
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
      symbols,
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
  }, [theme, JSON.stringify(symbols)]);

  return (
    <div className="tradingview-widget-container" ref={container}>
      <div className="tradingview-widget-container__widget"></div>
      <div className="tradingview-widget-copyright">
        <a href="https://www.tradingview.com/symbols/BSE-APOLLO/" rel="noopener nofollow" target="_blank"><span className="blue-text">APOLLO</span></a>
        <span className="and">&nbsp;and&nbsp;</span>
        <a href="https://www.tradingview.com/symbols/BSE-PERSISTENT/" rel="noopener nofollow" target="_blank"><span className="blue-text">PERSISTENT stock price</span></a>
        <span className="trademark">&nbsp;by TradingView</span>
      </div>
    </div>
  );
}

export default memo(TradingViewWidget);
