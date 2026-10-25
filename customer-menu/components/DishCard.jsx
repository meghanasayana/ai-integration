'use client';

import Image from 'next/image';
import { forwardRef, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { getDishBlurDataUrl } from '../utils/image';

export function VegIndicator({ isVeg }) {
  const isVegetarian = isVeg !== false;
  return (
    <div
      className={`type-dot ${isVegetarian ? 'veg' : 'nonveg'}`}
      title={isVegetarian ? 'Vegetarian' : 'Non-Vegetarian'}
    />
  );
}

function DietaryBadge({ label, emoji }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-[rgba(200,167,93,0.3)] bg-black/50 px-2 py-0.5 text-[10px] font-bold text-amber-200">
      {emoji && <span>{emoji}</span>}
      <span>{label}</span>
    </span>
  );
}

export function DietaryTags({ item }) {
  const tags = [];
  if (item.spicyLevel === 1 || item.spicyLevel === 'mild') {
    tags.push({ emoji: '🌶', label: 'Mild' });
  } else if (item.spicyLevel === 2 || item.spicyLevel === 'medium') {
    tags.push({ emoji: '🌶🌶', label: 'Spicy' });
  } else if (item.spicyLevel >= 3 || item.spicyLevel === 'hot') {
    tags.push({ emoji: '🌶🌶🌶', label: 'Extra Spicy' });
  }
  if (item.isJain) tags.push({ emoji: '🪔', label: 'Jain' });
  if (item.isVegan) tags.push({ emoji: '🥗', label: 'Vegan' });
  if (item.isGlutenFree) tags.push({ emoji: '🌾', label: 'Gluten-Free' });

  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {tags.map((tag) => (
        <DietaryBadge key={tag.label} {...tag} />
      ))}
    </div>
  );
}

const DishCard = forwardRef(function DishCard(
  {
    item,
    onSelect,
    resolveImageUrl,
    priority = false,
  },
  ref
) {
  const [activeAngle, setActiveAngle] = useState('front');
  const [frontFailed, setFrontFailed] = useState(false);
  const [topFailed, setTopFailed] = useState(false);

  const isUnavailable = !item.isAvailable;
  const isVeg = item.isVeg !== false && item.foodType !== 'non-veg';
  const frontImageUrl = resolveImageUrl ? resolveImageUrl(item.imageUrl) : item.imageUrl;
  const topViewImageUrl = resolveImageUrl
    ? resolveImageUrl(item.topViewImageUrl || item.top_view_image_url)
    : (item.topViewImageUrl || item.top_view_image_url);

  const hasFrontView = Boolean(frontImageUrl && !frontFailed);
  const hasTopView = Boolean(topViewImageUrl && !topFailed);
  const hasBothViews = hasFrontView && hasTopView;

  const currentImageUrl =
    activeAngle === 'top'
      ? hasTopView ? topViewImageUrl : frontImageUrl
      : hasFrontView ? frontImageUrl : topViewImageUrl;

  const hasAnyImage = Boolean(currentImageUrl && (activeAngle === 'top' ? !topFailed : !frontFailed));
  const initials =
    item.name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || 'R';

  const placeholder = (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090e15] text-amber-200">
      <UtensilsCrossed className="mb-2 h-7 w-7 text-amber-300/70" strokeWidth={1.5} />
      <span className="font-display text-2xl tracking-wider text-amber-100/80">{initials}</span>
    </div>
  );

  const priceNum = Number(item.price) || 0;

  // A dish sold in sizes shows the range, not just the cheapest one. Showing
  // "180" for a dish whose Full portion is 510 is the kind of wrong a diner
  // only finds out when the bill arrives.
  const portions = Array.isArray(item.portions) ? item.portions : [];
  const portionPrices = portions
    .map((p) => Number(p.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const priceDisplay =
    portionPrices.length > 1
      ? `₹${portionPrices[0].toFixed(0)} – ₹${portionPrices[portionPrices.length - 1].toFixed(0)}`
      : `₹${priceNum.toFixed(0)}`;

  const handleCardClick = (e) => {
    if (isUnavailable) return;
    onSelect(item, ref?.current || e.currentTarget, activeAngle);
  };

  return (
    <article
      ref={ref}
      className={`dish-card ${isUnavailable ? 'opacity-70 cursor-not-allowed' : ''}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={isUnavailable ? -1 : 0}
      aria-label={`${item.name}, Price ${priceDisplay}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick(e);
        }
      }}
    >
      <div className="dish-photo-wrap">
        {hasAnyImage ? (
          <Image
            key={currentImageUrl}
            src={currentImageUrl}
            alt={item.name}
            fill
            sizes="(min-width: 900px) 33vw, 50vw"
            placeholder="blur"
            blurDataURL={getDishBlurDataUrl(item.name)}
            priority={priority}
            loading={priority ? undefined : 'lazy'}
            className="dish-photo"
            onError={() => {
              if (activeAngle === 'top') setTopFailed(true);
              else setFrontFailed(true);
            }}
          />
        ) : (
          placeholder
        )}
        <div className="dish-photo-overlay" />

        {/* Tag / Sold Out */}
        {isUnavailable ? (
          <div className="dish-tag border-rose-500 text-rose-300">Sold Out</div>
        ) : item.specialTags ? (
          <div className="dish-tag">{item.specialTags}</div>
        ) : null}

        {/* Veg / Non-Veg Indicator */}
        <div className={`type-dot ${isVeg ? 'veg' : 'nonveg'}`} />

        {/* Dual Angle Toggle */}
        {hasBothViews && !isUnavailable && (
          <div
            className="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded bg-black/85 p-0.5 border border-white/20 text-[9px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setActiveAngle('front')}
              className={`px-1.5 py-0.5 rounded font-bold uppercase transition ${
                activeAngle === 'front'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              Front
            </button>
            <button
              type="button"
              onClick={() => setActiveAngle('top')}
              className={`px-1.5 py-0.5 rounded font-bold uppercase transition ${
                activeAngle === 'top'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              Top
            </button>
          </div>
        )}
      </div>

      <div className="dish-info">
        <h3 className="dish-name">{item.name}</h3>
        <div className="dish-price">{priceDisplay}</div>
        {portions.length > 1 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {portions.map((p) => (
              <span
                key={p.id || p.portion}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-[#f6f2eb]/80"
              >
                {p.portion} &#8377;{Number(p.price).toFixed(0)}
              </span>
            ))}
          </div>
        )}

        {item.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-slate-400 mb-2">
            {item.description}
          </p>
        )}

        <DietaryTags item={item} />

        <button type="button" className="view-btn mt-3">
          View Dish
        </button>
      </div>
    </article>
  );
});

export default DishCard;