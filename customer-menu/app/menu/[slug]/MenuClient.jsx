'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { trackEvent } from '../../../utils/analytics';
import MenuHero from '../../../components/MenuHero';
import { DietaryFilters } from '../../../components/SearchBar';
import CategoryRail from '../../../components/CategoryRail';
import DishCard from '../../../components/DishCard';
import ComboCard from '../../../components/ComboCard';
import DishSheet from '../../../components/DishSheet';
import ReviewSection from '../../../components/ReviewSection';
import Footer from '../../../components/Footer';
import EmptyState from '../../../components/EmptyState';
import RateUsModal from '../../../components/RateUsModal';
import { SkeletonPage } from '../../../components/Skeletons';
import SplashScreen from '../../../components/SplashScreen';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
const FILTER_IDS = ['veg', 'non-veg', 'vegan', 'jain', 'gluten-free', 'available'];

function resolveImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${API_URL}${url}`;
  return url;
}

function groupItemsByCategory(items, categories = []) {
  const groups = {};
  const order = [];

  if (Array.isArray(categories)) {
    for (const cat of categories) {
      const catId = cat.id || cat._id;
      groups[catId] = { id: catId, name: cat.name, items: [] };
      order.push(catId);
    }
  }

  for (const item of items) {
    const catId = item.categoryId || item.category?.id || item.categoryName || 'Other';
    const catName = item.category?.name || item.categoryName || 'Other';
    if (!groups[catId]) {
      groups[catId] = { id: catId, name: catName, items: [] };
      order.push(catId);
    }
    groups[catId].items.push({
      ...item,
      categoryName: item.categoryName || item.category?.name || catName,
    });
  }

  return order.map((k) => groups[k]).filter((g) => g && g.items && g.items.length > 0);
}

export default function MenuClient({ params }) {
  const { slug } = params;

  const [state, setState] = useState('loading');
  const [restaurant, setRestaurant] = useState(null);
  const [categoryGroups, setCategoryGroups] = useState([]);
  const [combos, setCombos] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedAngle, setSelectedAngle] = useState('front');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState([]);
  const [sortBy, setSortBy] = useState('default');
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const [splashFinished, setSplashFinished] = useState(false);

  const sectionRefs = useRef({});
  const searchInputRef = useRef(null);
  const triggerCardRef = useRef(null);
  const trackedItemRef = useRef(null);

  // Restore query params from URL
  useEffect(() => {
    const url = new URL(window.location.href);
    const restoredFilters = (url.searchParams.get('filters') || '')
      .split(',')
      .filter((filter) => FILTER_IDS.includes(filter));
    setSearchQuery(url.searchParams.get('q') || '');
    setActiveFilters(restoredFilters);
    setSortBy(url.searchParams.get('sort') || 'default');
    setUrlReady(true);
  }, []);

  // Sync state back to URL
  useEffect(() => {
    if (!urlReady) return;
    const url = new URL(window.location.href);
    if (searchQuery.trim()) url.searchParams.set('q', searchQuery.trim());
    else url.searchParams.delete('q');
    if (activeFilters.length > 0) url.searchParams.set('filters', activeFilters.join(','));
    else url.searchParams.delete('filters');
    if (sortBy && sortBy !== 'default') url.searchParams.set('sort', sortBy);
    else url.searchParams.delete('sort');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [activeFilters, searchQuery, sortBy, urlReady]);

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch menu
  const fetchMenu = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`${API_URL}/api/menu/${slug}`);
      if (res.status === 404) {
        setState('notfound');
        return;
      }
      if (res.status === 403) {
        setState('suspended');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      const data = await res.json();

      if (data.restaurant?.status === 'suspended' || data.suspended) {
        setState('suspended');
        return;
      }

      setRestaurant(data.restaurant || data);

      let items = data.foodItems || data.items || data.menuItems || [];
      if (items.length === 0 && data.categories && Array.isArray(data.categories)) {
        items = data.categories.flatMap((cat) =>
          (cat.items || cat.foodItems || []).map((item) => ({
            ...item,
            categoryId: cat.id || cat._id,
            categoryName: item.categoryName || cat.name,
          }))
        );
      }

      const groups = groupItemsByCategory(items, data.categories || []);
      setCategoryGroups(groups);
      setCombos(Array.isArray(data.combos) ? data.combos : []);
      setState('ready');
    } catch (err) {
      try {
        const fallback = await import('../../../data/anbude-cafe-menu.json');
        const data = fallback.default || fallback;
        setRestaurant(data.restaurant || data);
        let items = data.foodItems || data.items || data.menuItems || [];
        if (items.length === 0 && data.categories && Array.isArray(data.categories)) {
          items = data.categories.flatMap((cat) =>
            (cat.items || cat.foodItems || []).map((item) => ({
              ...item,
              categoryId: cat.id || cat._id,
              categoryName: item.categoryName || cat.name,
            }))
          );
        }
        const groups = groupItemsByCategory(items, data.categories || []);
        setCategoryGroups(groups);
        setCombos(Array.isArray(data.combos) ? data.combos : []);
        setState('ready');
      } catch (fallbackErr) {
        setState('error');
      }
    }
  }, [slug]);

  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  // Analytics
  useEffect(() => {
    if (state !== 'ready') return;
    trackEvent(slug, 'qr_scan');
    trackEvent(slug, 'menu_view');
  }, [slug, state]);

  // Deep-linking
  useEffect(() => {
    if (state !== 'ready' || selectedItem) return;
    const searchParams = new URLSearchParams(window.location.search);
    const deepLinkedId = searchParams.get('dish');
    if (!deepLinkedId) return;
    const deepLinkedItem = categoryGroups
      .flatMap((group) => group.items)
      .find((item) => String(item.id || item._id) === deepLinkedId);
    if (deepLinkedItem) {
      setSelectedItem(deepLinkedItem);
      const angleParam = searchParams.get('angle');
      if (angleParam === 'top') setSelectedAngle('top');
    }
  }, [categoryGroups, selectedItem, state]);

  // Track dish view
  useEffect(() => {
    if (!selectedItem) {
      trackedItemRef.current = null;
      return;
    }
    const itemId = selectedItem.id || selectedItem._id;
    const trackingKey = String(itemId || selectedItem.name);
    if (trackedItemRef.current === trackingKey) return;
    trackedItemRef.current = trackingKey;
    trackEvent(slug, 'item_view', itemId);
  }, [selectedItem, slug]);

  const handleCategorySelect = (catId) => {
    setActiveCategory(catId);
    if (catId === 'all') {
      const el = document.getElementById('menuSection');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const el = sectionRefs.current[catId];
    if (el) {
      const navHeight = 90;
      const top = el.getBoundingClientRect().top + window.scrollY - navHeight;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  const handleItemSelect = (item, triggerElement, angle = 'front') => {
    triggerCardRef.current = triggerElement;
    setSelectedItem(item);
    setSelectedAngle(angle || 'front');
    const url = new URL(window.location.href);
    url.searchParams.set('dish', item.id || item._id);
    if (angle && angle !== 'front') {
      url.searchParams.set('angle', angle);
    } else {
      url.searchParams.delete('angle');
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const handleSheetClose = useCallback(() => {
    setSelectedItem(null);
    setSelectedAngle('front');
    const url = new URL(window.location.href);
    url.searchParams.delete('dish');
    url.searchParams.delete('angle');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const handleToggleFilter = (filterId) => {
    setActiveFilters((current) =>
      current.includes(filterId)
        ? current.filter((filter) => filter !== filterId)
        : [...current, filterId]
    );
  };

  const handleClearAll = () => {
    setSearchQuery('');
    setActiveFilters([]);
    setSortBy('default');
  };

  // Filter groups
  const filteredGroups = useMemo(() => {
    return categoryGroups
      .map((group) => {
        let items = group.items.filter((item) => {
          const normalizedIngredients = Array.isArray(item.ingredients)
            ? item.ingredients.join(' ')
            : item.ingredients || '';

          const matchesSearch = debouncedSearch
            ? item.name?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
              item.description?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
              normalizedIngredients.toLowerCase().includes(debouncedSearch.toLowerCase())
            : true;

          const isVeg = item.isVeg !== false && item.foodType !== 'non-veg';
          const matchesDiet = activeFilters.every((filter) => {
            if (filter === 'veg') return isVeg;
            if (filter === 'non-veg') return !isVeg;
            if (filter === 'vegan') return item.isVegan;
            if (filter === 'jain') return item.isJain;
            if (filter === 'gluten-free') return item.isGlutenFree;
            if (filter === 'available') return item.isAvailable;
            return true;
          });

          return matchesSearch && matchesDiet;
        });

        if (sortBy === 'price-asc') {
          items = [...items].sort((a, b) => Number(a.price) - Number(b.price));
        } else if (sortBy === 'price-desc') {
          items = [...items].sort((a, b) => Number(b.price) - Number(a.price));
        }

        return { ...group, items };
      })
      .filter((g) => g.items.length > 0);
  }, [categoryGroups, debouncedSearch, activeFilters, sortBy]);

  const resultCount = filteredGroups.reduce((total, group) => total + group.items.length, 0);

  /**
   * Combos shown for the current search.
   *
   * A combo matches on its name or on anything inside it, so searching
   * "biryani" finds the combos that contain one as well as the dish itself.
   * With no search, every combo is shown.
   */
  const visibleCombos = useMemo(() => {
    const available = combos.filter((combo) => combo.isAvailable !== false);
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return available;

    return available.filter((combo) => {
      if (combo.name?.toLowerCase().includes(query)) return true;
      return (combo.lines || []).some((line) =>
        (line.options || []).some((option) => option.toLowerCase().includes(query)),
      );
    });
  }, [combos, debouncedSearch]);

  const allCategories = categoryGroups.map((g) => ({ id: g.id, name: g.name }));
  let cardIndex = 0;

  return (
    <div className="min-h-screen bg-[#06090d] font-sans text-[#f6f2eb]">
      {!splashFinished && (
        <SplashScreen
          isLoading={state === 'loading'}
          restaurant={restaurant}
          minDuration={2300}
          onFinish={() => setSplashFinished(true)}
        />
      )}

      {state === 'loading' ? (
        <SkeletonPage />
      ) : state === 'notfound' ? (
        <EmptyState variant="notFound" />
      ) : state === 'suspended' ? (
        <EmptyState variant="suspended" />
      ) : state === 'error' ? (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#06090d] px-6 text-center text-slate-100">
          <h2 className="mb-2 font-display text-2xl font-bold text-amber-200">Connection Issue</h2>
          <p className="mb-6 max-w-xs text-xs text-slate-400">
            Could not connect to the dining network. Check your internet connection and retry.
          </p>
          <button
            onClick={fetchMenu}
            className="gold-accent-btn rounded px-6 py-2.5 text-xs font-bold uppercase tracking-wider"
          >
            Retry Loading Menu
          </button>
        </div>
      ) : (
        <>
          {/* ════ 1. CINEMATIC HERO ════ */}
      <MenuHero
        restaurant={restaurant}
        resolveImageUrl={resolveImageUrl}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchInputRef={searchInputRef}
      />

      {/* ════ 2. MENU INTRO HEADING ════ */}
      <section className="menu-intro" id="menuSection" aria-labelledby="menuHeading">
        <div>
          <span className="menu-intro-eyebrow">THE HOUSE MENU</span>
          <h2 id="menuHeading">
            Gather around <em>the table.</em>
          </h2>
        </div>
        <p>
          A thoughtful culinary selection curated by {restaurant?.name || 'our chefs'}, prepared fresh to order.
        </p>
      </section>

      {/* ════ 3. DIETARY FILTERS & SORTING BAR ════ */}
      <DietaryFilters
        activeFilters={activeFilters}
        onToggleFilter={handleToggleFilter}
        sortBy={sortBy}
        onSortChange={setSortBy}
        onClearAll={handleClearAll}
        resultCount={resultCount}
      />

      {/* ════ 4. STICKY CATEGORY NAVIGATION ════ */}
      <CategoryRail
        categories={allCategories}
        activeCategory={activeCategory}
        onSelect={handleCategorySelect}
        onActiveChange={setActiveCategory}
      />

      {/* ════ 5. DISH GRID MAIN SECTION ════ */}
      <main className="relative pb-24 pt-4">
        {/* Combos sit above the categories, the way the printed menu gives
            them their own page. A search hides the ones it does not match
            rather than leaving them there looking like results. */}
        {visibleCombos.length > 0 && (
          <section className="scroll-mt-24 mb-8">
            <div className="mx-auto max-w-[1240px] px-5 py-3 flex items-center justify-between border-b border-white/[0.08] mb-3">
              <div className="flex items-center gap-3">
                <h3 className="font-display text-xl sm:text-2xl text-[#f6f2eb] font-semibold tracking-wide">
                  Combos
                </h3>
                <span className="text-[10px] tracking-widest text-[#d4b15d] font-bold uppercase border border-[#d4b15d]/40 px-2 py-0.5 rounded">
                  {visibleCombos.length} {visibleCombos.length === 1 ? 'COMBO' : 'COMBOS'}
                </span>
              </div>
            </div>

            <div className="mx-auto max-w-[1240px] px-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleCombos.map((combo) => (
                <ComboCard key={combo.id || combo.name} combo={combo} />
              ))}
            </div>
          </section>
        )}

        {filteredGroups.length === 0 ? (
          <div className="mx-auto max-w-[800px] px-4 py-16">
            <EmptyState variant="search" onReset={handleClearAll} />
          </div>
        ) : (
          filteredGroups.map((group) => (
            <section
              key={group.id}
              ref={(el) => {
                sectionRefs.current[group.id] = el;
              }}
              data-category-id={group.id}
              className="scroll-mt-24 mb-6"
            >
              <div className="mx-auto max-w-[1240px] px-5 py-3 flex items-center justify-between border-b border-white/[0.08] mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-display text-xl sm:text-2xl text-[#f6f2eb] font-semibold tracking-wide">
                    {group.name}
                  </h3>
                  <span className="text-[10px] tracking-widest text-[#d4b15d] font-bold uppercase border border-[#d4b15d]/40 px-2 py-0.5 rounded">
                    {group.items.length} {group.items.length === 1 ? 'ITEM' : 'ITEMS'}
                  </span>
                </div>
              </div>

              <div className="dish-grid">
                {group.items.map((item) => (
                  <DishCard
                    key={item.id || item._id || item.name}
                    item={item}
                    priority={cardIndex++ < 4}
                    onSelect={handleItemSelect}
                    resolveImageUrl={resolveImageUrl}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {/* ════ 6. REVIEW & FEEDBACK SECTION ════ */}
        <ReviewSection
          restaurant={restaurant}
          onRateUs={() => setRateModalOpen(true)}
        />

        {/* ════ 7. FOOTER ════ */}
        <Footer restaurant={restaurant} />
      </main>

      {/* ════ 8. DISH DETAIL MODAL ════ */}
      {selectedItem && (
        <DishSheet
          item={selectedItem}
          initialAngle={selectedAngle}
          onClose={handleSheetClose}
          resolveImageUrl={resolveImageUrl}
        />
      )}

      {/* Rate Us Modal */}
      <RateUsModal
        isOpen={rateModalOpen}
        onClose={() => setRateModalOpen(false)}
        restaurant={restaurant}
      />
        </>
      )}
    </div>
  );
}
