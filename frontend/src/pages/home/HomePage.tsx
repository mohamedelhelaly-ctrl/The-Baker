import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { buttonClass } from "../../components/ui/buttonClass";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { WEEKDAYS, formatTime, hhmm } from "../../lib/dates";
import { openNowLine, todayEntry, todayLine } from "../../lib/hours";
import { useMoney, useStore } from "../../lib/store";
import type { Category, Page, ProductListItem } from "../../lib/types";

const GROUPS = 3;
const ROWS = 5;

/** One group of the menu: a label, then up to five products with their "from" price. */
function Group({ category }: { category: Category }) {
  const money = useMoney();
  const products = useApi<Page<ProductListItem>>(`/products?category=${category.slug}&sort=featured&page_size=${ROWS}`);
  return (
    <section aria-labelledby={`g-${category.slug}`}>
      <h3 id={`g-${category.slug}`} className="t-label mb-3">
        <Link to={`/menu?category=${category.slug}`} className="link-bare">
          {category.name}
        </Link>
      </h3>
      <ul className="rows">
        {products.data?.items.slice(0, ROWS).map((p) => (
          <li key={p.id}>
            <Link to={`/products/${p.slug}`} className="link-bare">
              {p.name}
            </Link>
            <span className="tnum shrink-0 text-muted">{money(p.price_from).replace(/\.00$/, "")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function HomePage() {
  const store = useStore();
  usePageTitle("Bakery in Cairo, baked to order");
  const categories = useApi<Category[]>("/categories");
  const { hash } = useLocation();
  const heroButton = useRef<HTMLAnchorElement>(null);
  const figure = useRef<HTMLElement>(null);
  const [arrived, setArrived] = useState(false);
  const first = todayEntry(store.opening_hours);
  const openFrom = first && !first.is_closed ? formatTime(hhmm(first.opens_at)) : null;
  const sub = openFrom ? `Cakes, pastries and bread from ${openFrom}, for delivery or pickup.` : "Cakes, pastries and bread, for delivery or pickup.";
  const openNow = openNowLine(store.opening_hours);
  const where = store.address ?? "Cairo, Egypt";

  // A link to /#visit lands on the visit block.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  // The phone's action bar shows once the hero's button has scrolled away.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".actionbar");
    const hero = heroButton.current;
    if (!bar || !hero || typeof IntersectionObserver === "undefined") return;
    const state = { hero: true };
    const apply = () => (bar.dataset.show = String(!state.hero));
    const heroObs = new IntersectionObserver(([e]) => {
      state.hero = e.isIntersecting;
      apply();
    });
    heroObs.observe(hero);
    apply();
    return () => {
      heroObs.disconnect();
    };
  }, []);

  // The one moment: the section's photograph develops once as it comes on screen.
  useEffect(() => {
    const el = figure.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setArrived(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setArrived(true);
          obs.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <section className="hero" aria-labelledby="hero-h">
        <div className="overflow-hidden">
          <img
            src="/photos/baker-cover-1920.webp"
            srcSet="/photos/baker-cover-800.webp 800w, /photos/baker-cover-1280.webp 1280w, /photos/baker-cover-1920.webp 1920w"
            sizes="(max-width: 639px) 189vw, 100vw"
            width={1920}
            height={1076}
            alt="A paper-craft baker in a white hat setting out pastries at a counter, with shelves of cakes and bread behind"
            fetchPriority="high"
            data-source="client"
            className="enter-settle block h-[min(480px,53svh)] w-full object-cover object-[50%_62%] max-sm:h-[min(488px,48svh)]"
          />
        </div>
        <div className="wrap page grid gap-x-10 gap-y-6 pb-12 pt-10 sm:grid-cols-2 sm:pb-16">
          <div className="enter-mask">
            <h1 id="hero-h" className="enter-rise font-display text-[32px] leading-[37px] sm:text-5xl sm:leading-[1.1]">
              Bakery in Cairo, baked to order
            </h1>
          </div>
          <div>
            <p className="enter-fade text-lg sm:text-xl sm:leading-[30px]" style={{ animationDelay: "480ms" }}>
              {sub}
            </p>
            <p className="enter-fade mt-6" style={{ animationDelay: "540ms" }}>
              <Link ref={heroButton} to="/menu" className={buttonClass("primary", "px-8 max-sm:w-full")}>
                Order now
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="m-arrow">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section id="shop" aria-labelledby="shop-h" className="wrap page py-16 sm:py-24">
        <h2 id="shop-h" className="mb-10 font-display text-2xl sm:text-[32px] sm:leading-10">
          Menu and prices
        </h2>
        <div className="grid items-start gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {categories.data?.slice(0, GROUPS).map((c) => (
            <Group key={c.id} category={c} />
          ))}
          <figure ref={figure} className="develop m-0 overflow-hidden" data-state={arrived ? "arrived" : "waiting"} data-moment="picture-develops">
            <Link to="/menu?category=breads" aria-label="See the breads" className="group block overflow-hidden">
              <img
                src="/photos/photo-m37164269-1200.webp"
                width={1200}
                height={896}
                loading="lazy"
                alt="Rye dough rising in woven baskets on a wooden table"
                data-source="stand-in"
                className="aspect-square w-full object-cover transition-transform duration-[600ms] group-hover:scale-[1.03]"
              />
            </Link>
          </figure>
        </div>

        <div id="visit" className="mt-20 grid gap-x-6 gap-y-10 border-t border-hairline pt-12 md:grid-cols-3">
          <div>
            <h3 className="mb-3 font-display text-2xl">Visit</h3>
            <p className="text-xl leading-[30px]">{where}</p>
            {store.pickup_location && <p className="mt-2 text-muted">Collect from: {store.pickup_location}</p>}
            {store.address && (
              <p className="mt-3">
                <a className="link" href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(store.address)}`} target="_blank" rel="noreferrer">
                  Get directions
                </a>
              </p>
            )}
          </div>
          <div>
            <h3 className="mb-3 font-display text-2xl">Opening hours</h3>
            {openNow && <p className="mb-2 font-medium">{openNow}</p>}
            {store.opening_hours.length > 0 ? (
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
                {[...store.opening_hours]
                  .sort((a, b) => a.weekday - b.weekday)
                  .map((h) => {
                    const isToday = todayEntry(store.opening_hours)?.weekday === h.weekday;
                    return (
                      <div key={h.weekday} className={`contents ${isToday ? "font-medium" : ""}`}>
                        <dt>{WEEKDAYS[h.weekday]}</dt>
                        <dd className="tnum">{h.is_closed ? "Closed" : `${formatTime(hhmm(h.opens_at))} to ${formatTime(hhmm(h.closes_at))}`}</dd>
                      </div>
                    );
                  })}
              </dl>
            ) : (
              <p className="text-muted">Hours are set by the bakery.</p>
            )}
          </div>
          <div>
            <h3 className="mb-3 font-display text-2xl">Delivery and pickup</h3>
            <p>{todayLine(store.opening_hours) ? "Order ahead for a delivery or pickup day and time you choose." : "Order ahead for a day and time you choose."}</p>
            {store.pickup_instructions && <p className="mt-2 text-muted">{store.pickup_instructions}</p>}
            <p className="mt-3">
              <Link to="/delivery" className="link">
                Delivery areas and fees
              </Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
