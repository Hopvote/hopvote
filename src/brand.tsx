// Applies a presentation's brand to the big screen and the phones.
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { bgCss, brandVars, fontFace, fontLinks, imageVeil, isDark, type Brand } from "./brand-core";

export type { Bg, Brand, FontId } from "./brand-core";
export { isDark } from "./brand-core";

// `given`: a brand the page already has (the previews, the design studio): the server is not asked, its fonts still load.
export function useBrand(code: string, given?: Brand | null) {
  const [fetched, setBrand] = useState<Brand | null>(null);
  const own = given !== undefined;
  useEffect(() => {
    // No code: an example screen, in Hopvote's own colors.
    if (!code || own) return;
    fetch(`/api/rooms/${code}/brand`)
      .then((r) => (r.ok ? (r.json() as Promise<{ brand: Brand | null }>) : { brand: null }))
      .then((d) => setBrand(d.brand))
      .catch(() => {});
  }, [code, own]);
  const brand = own ? given : fetched;
  useBrandFonts(brand);
  return brand;
}

// Loads the brand's Google Fonts and its uploaded font, once per page.
export function useBrandFonts(brand: Brand | null) {
  const links = brand ? fontLinks(brand).join("|") : "";
  const face = brand ? fontFace(brand) : "";
  useEffect(() => {
    for (const href of links.split("|").filter(Boolean)) {
      if (!document.querySelector(`link[href="${href}"]`)) document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
    }
  }, [links]);
  useEffect(() => {
    if (!face) return;
    const style = Object.assign(document.createElement("style"), { textContent: face });
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [face]);
}

// Style and classes for a branded surface. `dark` is null when Hopvote's default colors apply.
export function brandLook(brand: Brand | null): { style: CSSProperties; dark: boolean | null; className: string } {
  if (!brand) return { style: {}, dark: null, className: "" };
  const { vars, dark } = brandVars(brand);
  const style: Record<string, string> = { ...vars };
  if (brand.bg) {
    style.background = bgCss(brand.bg, "", dark);
    // The ground's main color, for what is drawn on it (rings, opaque rows, color mixes): the brand's, not Hopvote's navy.
    style["--ground"] = brand.bg.kind === "color" ? brand.bg.value : brand.bg.kind === "gradient" ? `color-mix(in srgb, ${brand.bg.value}, ${brand.bg.value2})` : imageVeil(brand.bg, dark).color;
  }
  if (vars["--font-body"]) style.fontFamily = "var(--font-body)";
  const className = ["branded", dark === false && "brand-light", dark === true && "brand-dark", brand.card && isDark(brand.card) && "card-dark"].filter(Boolean).join(" ");
  return { style: style as CSSProperties, dark, className };
}

// Phones show the brand on the whole page, not only the narrow column.
export function useBodyBrand(brand: Brand | null) {
  useEffect(() => {
    const { style, className } = brandLook(brand);
    const body = document.body;
    for (const [k, v] of Object.entries(style)) {
      if (k.startsWith("--")) body.style.setProperty(k, String(v));
      else if (k === "background") body.style.background = String(v);
      else if (k === "fontFamily") body.style.fontFamily = String(v);
    }
    if (brand?.bg?.kind === "image") body.style.backgroundAttachment = "fixed";
    const classes = className.split(" ").filter(Boolean);
    body.classList.add(...classes);
    return () => {
      body.removeAttribute("style");
      body.classList.remove(...classes);
    };
  }, [brand]);
}

// The logo exactly as uploaded: no frame, height from the brand's logo size.
export function BrandLogo({ brand, className = "" }: { brand: Brand | null; className?: string }) {
  if (!brand?.logo) return null;
  return <img className={`brand-logo ${className}`} src={brand.logo} alt="" />;
}
