'use strict'

/**
 * Descriptions that do not need a model.
 *
 * Most of an Indian restaurant menu is not unique to that restaurant.
 * "Chicken 65", "Paneer Butter Masala" and "Gulab Jamun" are on thousands of
 * menus, and a great many more dishes are one preparation applied to a list
 * of ingredients: Chilly Paneer, Chilly Gobi, Chilly Mushroom, Chilly Fish.
 *
 * Measured on a real 13-page menu: 668 dishes, but only 421 distinct
 * preparations, with 88 families covering 335 of those dishes.
 *
 * So this file answers in two ways. An exact name match returns a written
 * description. Otherwise the ingredient is separated from the preparation and
 * the preparation's template is filled in. Both are instant and cost nothing,
 * which matters when the local model takes seventeen seconds a dish.
 */

/** Ingredients a menu varies a preparation across, and how to say them. */
const INGREDIENTS = {
  // --- Tamil and Telugu, the words a local menu actually prints ---
  //
  // Without these, "Eeral Varuval" and "Meen Kuzhambu" meant nothing here and
  // were handed to the model to guess at. They are not guesses: the name says
  // what the dish is. Eeral is liver, varuval is a dry fry. Translating a name
  // is not inventing a description.
  kozhi: 'chicken',
  'nattu kozhi': 'country chicken',
  kodi: 'chicken',
  kari: 'mutton',
  'attu kari': 'mutton',
  mamsam: 'mutton',
  eeral: 'goat liver',
  boti: 'goat tripe',
  meen: 'fish',
  chepa: 'fish',
  eral: 'prawns',
  royyalu: 'prawns',
  nandu: 'crab',
  kanava: 'squid',
  nethili: 'anchovies',
  vanjaram: 'seer fish',
  sankara: 'red snapper',
  paarai: 'trevally',
  parai: 'trevally',
  koduva: 'sea bass',
  muttai: 'egg',
  kodiguddu: 'egg',
  urulai: 'potato',
  vazhakkai: 'raw banana',
  vendakkai: 'okra',
  bendakaya: 'okra',
  kathirikai: 'brinjal',
  vankaya: 'brinjal',
  kaalan: 'mushroom',
  keerai: 'greens',
  gongura: 'sorrel leaves',
  murungakkai: 'drumstick',
  thayir: 'curd',
  paal: 'milk',
  thengai: 'coconut',
  elaneer: 'tender coconut',

  paneer: 'paneer',
  panner: 'paneer',
  gobi: 'cauliflower florets',
  cauliflower: 'cauliflower florets',
  mushroom: 'mushroom',
  babycorn: 'baby corn',
  'baby corn': 'baby corn',
  veg: 'mixed vegetables',
  vegetable: 'mixed vegetables',
  chicken: 'chicken',
  mutton: 'mutton',
  prawn: 'prawns',
  prawns: 'prawns',
  fish: 'fish',
  egg: 'egg',
  aloo: 'potato',
  bhindi: 'okra',
  palak: 'spinach',
  kaju: 'cashew',
  soya: 'soya chunks',
  apple: 'apple',
  banana: 'banana',
  mango: 'mango',
  orange: 'orange',
  pineapple: 'pineapple',
  'pine apple': 'pineapple',
  watermelon: 'watermelon',
  strawberry: 'strawberry',
  chocolate: 'chocolate',
  oreo: 'Oreo',
  pista: 'pistachio',
  chiku: 'chikoo',
  anjur: 'fig',
  kiwi: 'kiwi',
  papaya: 'papaya',
  muskmelon: 'muskmelon',
  carrot: 'carrot',
  grabe: 'grape',
  mousambi: 'sweet lime',
  corn: 'sweet corn',
  butterscotch: 'butterscotch',
  vennila: 'vanilla',
  vanilla: 'vanilla',
  coconut: 'tender coconut',
  'black current': 'blackcurrant',
  'dry fruit': 'dry fruit',
  pomogranets: 'pomegranate',
  cooktails: 'mixed fruit',
  'dragon fruit': 'dragon fruit',
  lime: 'lime',
}

/**
 * One preparation, written once, filled in per ingredient.
 * `{x}` is the ingredient. Every line follows the restaurant's house style:
 * one sentence, appetising, nothing claimed that the name does not imply.
 */
const PREPARATIONS = {
  // --- Tamil and Telugu cooking methods ---
  //
  // Each of these states what the word means and nothing more. "Kuzhambu" is
  // a tamarind gravy; saying so is translation. What these templates must
  // never do is name an ingredient the dish name has not - that is the line
  // between describing a dish and inventing one.
  'milagu varuval': 'Dry-fried {x} with plenty of crushed black pepper and curry leaves.',
  'milagu roast': 'Slow-roasted {x} in a thick coating of crushed black pepper.',
  milagu: 'Peppery {x}, cooked dry with freshly crushed black pepper.',
  kuzhambu: '{x} simmered in a tangy tamarind gravy, the everyday South Indian kuzhambu.',
  thokku: '{x} cooked down into a thick, dark masala that clings to every piece.',
  poriyal: '{x} stir-fried with grated coconut and tempered mustard seed.',
  vepudu: 'Dry-fried {x}, Andhra style, hot with red chilli.',
  iguru: '{x} in a thick, semi-dry onion masala.',
  pulusu: '{x} in a tangy tamarind stew, sweet-sour and soupy.',
  paya: 'Slow-simmered {x} broth, light-bodied and peppery.',
  rasam: 'A thin, peppery {x} broth, drunk hot alongside the meal.',
  'bone soup': 'Marrow bones simmered into a clear, peppery {x} broth.',
  'kothu parotta': 'Shredded parotta griddled with {x} and a dark pepper masala.',
  kothu: 'Shredded parotta griddled with {x} and a dark pepper masala.',
  'kola urundai': 'Spiced {x} mince rolled and fried into firm, peppery balls.',
  dosai: 'A crisp rice-and-lentil crepe, griddled thin, filled with {x}.',
  'tawa fry': 'Marinated {x} seared on a hot griddle until the edges crisp.',
  masala: '{x} in a thick onion and tomato masala, deep with roasted spice.',
  // Two towns whose biryani is its own style, and a general model tends to
  // blur them together. Dindigul uses short jeeraga samba rice and far more
  // pepper; Ambur leans on dried red chilli.
  'dindigul thalappakatti': 'Dindigul-style {x} biryani, peppery, with short-grain jeeraga samba rice.',
  thalappakatti: 'Dindigul-style {x}, peppery and generous with whole spice.',
  'thalappakatti fry': 'Dindigul-style {x}, fried dry with crushed pepper and curry leaves.',
  'dindigul fry': 'Dindigul-style {x}, fried dry and heavy with black pepper.',
  ambur: 'Ambur-style {x} biryani, cooked with dried red chilli and short-grain rice.',
  'ambur biryani': 'Ambur-style {x} biryani, cooked with dried red chilli and short-grain rice.',
  lollipop: 'Frenched {x} wings, marinated red and fried crisp to the bone.',
  bhurji: 'Scrambled {x} tossed with onion, tomato and green chilli.',
  'boti fry': 'Goat tripe, cleaned and fried dry with onion, pepper and curry leaves.',
  'fish fry': 'Marinated {x} shallow-fried until crisp outside and moist within.',
  fry: 'Marinated {x} fried until crisp at the edges.',

  '65': 'Crisp fried {x} tossed with curry leaves, ginger and red chillies for a fiery South Indian bite.',
  'chilly': 'Crisp fried {x} tossed with onion, capsicum and green chillies in a glossy, spicy sauce.',
  'manchurian': 'Golden fried {x} simmered in a tangy garlic and soy sauce with spring onion.',
  'pepper fry': 'Dry-tossed {x} coated in crushed black pepper and curry leaves until deeply fragrant.',
  'pepper masala': 'Tender {x} in a thick onion gravy sharpened with freshly crushed black pepper.',
  'ginger garlic': 'Wok-tossed {x} in a punchy ginger and garlic sauce finished with spring onion.',
  'bell pepper': 'Stir-fried {x} with sliced bell peppers and onion in a light, savoury glaze.',
  'kadai masala': 'Tender {x} cooked in a kadai with tomato, onion and coarsely ground spices.',
  'butter masala': 'Soft {x} in a rich, creamy tomato gravy finished with butter and a hint of sweetness.',
  'tikka masala': 'Char-grilled {x} folded into a smooth, spiced tomato and cream gravy.',
  'dragon': 'Crisp fried {x} in a sweet and sharp chilli sauce with onion and roasted cashew.',
  'crispy fried': 'Lightly battered {x} fried till golden and crisp, dusted with pepper and salt.',
  'crispy chilly': 'Crisp fried {x} tossed in a hot, tangy chilli sauce with onion and capsicum.',
  'salt pepper': 'Crisp {x} tossed simply with salt, crushed pepper and spring onion.',
  'manchow soup': 'A hot, peppery broth with finely chopped {x}, topped with crisp fried noodles.',
  'clear soup': 'A light, clear broth with {x} and vegetables, gently seasoned and warming.',
  'pepper soup': 'A thin, peppery broth with {x}, finished with crushed black pepper.',
  'fried rice': 'Wok-tossed basmati rice with {x}, spring onion and a touch of soy.',
  'noodles': 'Stir-fried noodles with {x}, crisp vegetables and a savoury soy seasoning.',
  'biryani': 'Fragrant basmati rice layered with {x} and whole spices, slow-cooked for a rich, satisfying meal.',
  'pulao': 'Light basmati rice gently cooked with {x} and mild whole spices.',
  'tikka': 'Marinated {x} skewered and roasted in the tandoor until smoky and charred at the edges.',
  'kabab': 'Spiced {x} moulded onto skewers and grilled until juicy with a smoky finish.',
  'handi': 'Slow-cooked {x} in a sealed handi with onion, tomato and warm spices.',
  'kuruma': 'Mild {x} simmered in a coconut and cashew gravy with gentle spices.',
  'chukka': 'Dry-roasted {x} with shallots, curry leaves and a dark, peppery masala.',
  'varuval': 'Dry-fried {x} in a dark Chettinad masala with curry leaves and pepper.',
  'roast masala': 'Slow-roasted {x} in a thick, dark masala until the spices cling to every piece.',
  'coconut curry': 'Gently simmered {x} in a mild coconut gravy with curry leaves and mustard seed.',
  'lollypop': 'Frenched chicken wings fried crisp and tossed in a hot, tangy red sauce.',

  // Rice and noodles. The menu sells these as one line with a choice, so the
  // description has to cover both rather than pick one.
  'fried rice noodles': 'Wok-tossed rice or noodles with {x}, spring onion and a savoury soy seasoning.',
  'szechwan fried rice noodles': 'Fiery Szechwan rice or noodles with {x}, garlic and dried red chilli.',
  'chilly garlic f rice noodles': 'Rice or noodles tossed with {x} in a sharp chilli and garlic sauce.',
  'kuthu paratha': 'Shredded parotta tossed on the griddle with {x}, egg and a peppery masala.',
  'kathi roll': 'Soft parotta wrapped around spiced {x} with onion and a tangy chutney.',

  // Biryanis, which this menu sells several ways.
  'pot biryani': 'Basmati rice and {x} sealed in a clay pot and slow-cooked so the steam carries the spice through.',
  'potlam biryani': 'Rice and {x} tied in a banana leaf parcel and steamed until fragrant.',
  'hydrabadi biryani': 'Hyderabadi dum biryani layering {x} with saffron rice, fried onion and mint.',
  'mugal biryani': 'Mughlai biryani of {x} and basmati rice enriched with cashew, cream and warm spices.',

  // Soups.
  'cream of soup': 'A smooth, creamy soup of {x}, gently seasoned and finished with pepper.',
  'green chilly soup': 'A hot, clear broth of {x} sharpened with green chilli and coriander.',
  'red chilly soup': 'A warming broth of {x} with dried red chilli and a peppery finish.',
  'sweet corn soup': 'A thick, mild soup of sweet corn and {x}, lightly peppered.',
  'coriender soup': 'A light broth of {x} finished with fresh coriander and crushed pepper.',

  // Gravies and regional styles.
  'kerala': 'Kerala style {x} in a coconut gravy with curry leaves, mustard seed and shallots.',
  'chettinad': 'Chettinad {x} in a dark masala of roasted coconut, fennel and whole peppercorns.',
  'dopiyaza': 'Tender {x} cooked twice over with onion, browned and then folded in fresh.',
  'malai kofta': 'Soft dumplings of {x} in a mild, creamy cashew gravy.',
  'hydrapathi masala': 'Hyderabadi style {x} in a thick onion and tomato masala with warm spices.',

  // Dry preparations and tandoor.
  'rosted honey': 'Crisp fried {x} glazed in honey and chilli until sticky and glossy.',
  'salt pepper fry': 'Crisp {x} tossed simply with salt, crushed pepper and spring onion.',
  'arabic tikka': 'Yoghurt-marinated {x} grilled over charcoal with Arabic spices and a squeeze of lemon.',
  'hariyali tikka': 'Marinated {x} in a green paste of mint, coriander and green chilli, grilled till charred.',
  'malai tikka': 'Mild {x} in a cream and cheese marinade, grilled until just golden.',
  'tandoori parotta': 'Tandoor-roasted {x}, smoky and charred, served with a flaky parotta.',

  // Drinks and breads the menu lists in quantity.
  'milk shake': 'Thick, chilled milk blended with {x} until smooth and frothy.',
  'juice': 'Freshly pressed {x}, served chilled with nothing added but ice.',
  'kulcha': 'Soft leavened flatbread stuffed with {x} and baked in the tandoor.',

  // Named gravies this menu repeats across meats. Anything here is a dish
  // whose meaning is settled; the unusual ones - Talimen, Lajabab, Maharani -
  // are deliberately left out and go to the model, which may also refuse.
  'rogan josh': 'Slow-cooked {x} in a deep red Kashmiri gravy with fennel and dried ginger.',
  'mugalai': 'Mughlai {x} in a rich gravy of cashew, cream and warm whole spices.',
  'afghani': 'Mildly spiced {x} in a pale, creamy gravy of cashew, yoghurt and white pepper.',
  'punjabi masala': 'Punjabi style {x} in a robust onion and tomato masala with garam masala.',
  'rara masala': 'Slow-cooked {x} in a thick masala enriched with minced meat for extra body.',
  'green masala': 'Tender {x} in a fresh green gravy of coriander, mint and green chilli.',
  'mojitho': 'Crushed mint and lime topped with soda and {x} for a long, cold drink.',
  'mojito': 'Crushed mint and lime topped with soda and {x} for a long, cold drink.',
  'mix veg fry': 'Seasonal vegetables tossed on a hot tawa with onion and dry spices.',
}

/** Dishes worth writing out in full, because they are their own thing. */
const EXACT = {
  // --- South Indian dishes that stand on their own name ---
  idly: 'Soft steamed rice cakes, light and faintly sour, served hot.',
  'medhu vada': 'Crisp lentil doughnuts, fluffy within, fried golden.',
  'ven pongal': 'Creamy rice and lentils cooked with ghee, pepper and cumin.',
  idiyappam: 'Steamed rice string hoppers, soft and delicate.',
  'poori masala': 'Puffed fried bread served with a mild potato masala.',
  parotta: 'Flaky layered flatbread, griddled soft and pulled apart by hand.',
  'veechu parotta': 'Dough slapped paper-thin and griddled into a wide, flaky bread.',
  puliyodharai: 'Tamarind rice, tangy and peppery, tempered with sesame.',
  'thayir sadam': 'Cooled curd rice tempered with mustard seed, ginger and curry leaf.',
  'elumichai sadam': 'Lemon rice, bright and sharp, tempered with peanuts.',
  'ghee rice': 'Fragrant rice cooked in ghee with whole spices.',
  'ashoka halwa': 'A rich moong dal halwa, dense with ghee and cardamom.',
  'tirunelveli halwa': 'Wheat halwa cooked slowly in ghee until glossy and chewy.',
  'rava kesari': 'Semolina cooked with ghee, sugar and saffron into a soft sweet.',
  'paal payasam': 'Rice simmered slowly in sweetened milk until thick and fragrant.',
  'elaneer payasam': 'Tender coconut in chilled sweetened milk, light and cooling.',
  jigarthanda: 'Chilled milk with almond gum and nannari syrup, topped with ice cream.',
  'nannari sarbath': 'Sarsaparilla root syrup in iced water, cooling and faintly bitter.',
  'paneer soda': 'Rose-scented fizzy soda, sweet and sharply chilled.',
  'half boil': 'A soft-boiled egg served runny, straight from the shell.',
  omlette: 'Beaten egg cooked flat with onion, green chilli and coriander.',
  moru: 'Spiced buttermilk, thin and salted, with curry leaf and ginger.',
  'attu kal paya': 'Goat trotters simmered for hours into a light, peppery broth.',
  'pepper rasam': 'A thin, fiery broth of black pepper, cumin and tamarind.',
  'kari dosai': 'A crisp dosai griddled with spiced mutton mince pressed into it.',
  'plain dosai': 'A thin rice-and-lentil crepe, griddled crisp and golden.',
  'masala dosai': 'A crisp rice crepe wrapped around spiced potato masala.',
  'ghee roast': 'A dosai griddled crisp in ghee and rolled into a cone.',
  uthappam: 'A thick, soft rice pancake griddled with onion and green chilli.',
  chapathi: 'Soft wholewheat flatbread, griddled and lightly brushed with oil.',
  poori: 'Wholewheat bread rolled thin and fried until it puffs.',
  'kara kuzhambu': 'A fiery tamarind gravy, dark with roasted spice and dried chilli.',
  'vathal kuzhambu': 'Sun-dried vegetables simmered in a sharp, thin tamarind gravy.',
  tea: 'Strong tea boiled with milk and sugar, pulled frothy.',
  'badam milk': 'Warm milk with ground almonds, cardamom and saffron.',
  'elumichai juice': 'Fresh lime in chilled water, sweet and sharp.',
  'sweet corn soup': 'A mild, thick soup of sweet corn in a light broth.',

  'gulab jamun': 'Soft, golden milk-solid dumplings soaked in sweet, aromatic sugar syrup.',
  'rasmalai': 'Soft paneer discs resting in chilled, saffron-scented thickened milk with pistachio.',
  'gajar halwa': 'Grated carrot slow-cooked in milk and ghee with cardamom, finished with nuts.',
  'fruit salad': 'A refreshing mix of fresh, juicy seasonal fruits with natural sweetness in every bite.',
  'paneer butter masala': 'Soft paneer in a rich, creamy tomato gravy finished with butter and a hint of sweetness.',
  'palak paneer': 'Soft paneer folded through a smooth, garlicky spinach gravy with warm spices.',
  'dal fry': 'Yellow lentils simmered soft and finished with a sizzling tempering of cumin and garlic.',
  'dal makhani': 'Black lentils simmered overnight with butter and cream until thick and velvety.',
  'malai kofta': 'Soft paneer and potato dumplings in a mild, creamy cashew gravy.',
  'chicken 65': 'Crisp fried boneless chicken tossed with curry leaves, ginger and red chillies for a fiery bite.',
  'butter chicken': 'Tandoori chicken simmered in a silky tomato and butter gravy with a gentle sweetness.',
  'chicken chettinad': 'Chicken in a dark, peppery Chettinad masala of roasted coconut and whole spices.',
  'rogan josh': 'Mutton slow-cooked in a deep red Kashmiri gravy with fennel and dried ginger.',
  'fish molly': 'Fish gently simmered in a mild Kerala coconut gravy with green chilli and curry leaves.',
  'fish moly': 'Fish gently simmered in a mild Kerala coconut gravy with green chilli and curry leaves.',
  'prawn koliwada': 'Prawns in a crisp, tangy red batter fried golden, Mumbai dockside style.',
  'tandoori chicken': 'Yoghurt and spice marinated chicken roasted in the tandoor for a smoky, charred finish.',
  'french fry': 'Golden potato fries, crisp outside and fluffy within, lightly salted.',
  'onion rings': 'Sweet onion rings in a crisp golden batter, fried until light and crunchy.',
  'veg spring roll': 'Crisp pastry rolls filled with shredded vegetables and fried until golden.',
  'masala omelette': 'A fluffy omelette folded with onion, green chilli and fresh coriander.',
  'masala ombelet': 'A fluffy omelette folded with onion, green chilli and fresh coriander.',
  'egg bhurji': 'Scrambled egg tossed with onion, tomato and green chilli on a hot tawa.',
  'plain naan': 'Soft leavened flatbread baked against the wall of the tandoor until blistered.',
  'butter naan': 'Soft tandoor-baked flatbread brushed generously with melted butter.',
  'garlic naan': 'Tandoor-baked flatbread studded with garlic and fresh coriander.',
  'tandoori roti': 'Wholewheat flatbread baked in the tandoor until lightly charred and chewy.',
  'lacha parotta': 'Flaky layered flatbread, crisp on the outside and soft in its folds.',
  'curd rice': 'Cooled rice folded through set curd with a tempering of mustard and curry leaf.',
  'jeera rice': 'Basmati rice tossed with cumin seeds bloomed in ghee.',
  'steam rice': 'Plain steamed basmati rice, light and separate.',
  'fresh lime juice': 'Fresh lime pressed over chilled water, sweet or salted to taste.',
  'lassi': 'Thick churned curd served chilled, sweet or salted.',
  'filter coffee': 'Strong decoction coffee frothed with hot milk and served in a steel tumbler.',
}

/**
 * How menus misspell a preparation. Every one of these is from a real menu;
 * none is invented. Matching on the printed spelling matters more than being
 * right about it, because the printed spelling is what we are given.
 */
const SPELLINGS = {
  biriyani: 'biryani',
  briyani: 'biryani',
  biriyany: 'biryani',
  manchuriyan: 'manchurian',
  manchuriya: 'manchurian',
  manchurin: 'manchurian',
  chilli: 'chilly',
  chili: 'chilly',
  kabab: 'kabab',
  kebab: 'kabab',
  kebap: 'kabab',
  kurma: 'kuruma',
  korma: 'kuruma',
  chukka: 'chukka',
  chuka: 'chukka',
  pulav: 'pulao',
  pullao: 'pulao',
  noodle: 'noodles',
}

/** Words that tell you nothing about the preparation. */
const NOISE = new Set([
  'taj', 'spl', 'special', 'our', 'house', 'the', 'style', 'dry', 'gravy',
  'non', 'veg', 'plate', 'full', 'half', 'quarter', 'pcs', 'pieces', 'piece',
])

/** Lowercase, drop brackets and punctuation, collapse spaces. */
function normalise(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Separate what the dish is made of from how it is cooked.
 * "Mushroom Pepper Fry" -> { ingredient: 'mushroom', preparation: 'pepper fry' }
 */
function splitName(name) {
  const words = normalise(name).split(' ').filter(Boolean)

  let ingredient = null
  const rest = []

  for (let i = 0; i < words.length; i += 1) {
    const pair = `${words[i]} ${words[i + 1] ?? ''}`.trim()

    if (!ingredient && INGREDIENTS[pair]) {
      ingredient = INGREDIENTS[pair]
      i += 1
      continue
    }
    if (!ingredient && INGREDIENTS[words[i]]) {
      ingredient = INGREDIENTS[words[i]]
      continue
    }
    rest.push(words[i])
  }

  const preparation = rest
    .filter((w) => !NOISE.has(w))
    .map((w) => SPELLINGS[w] || w)
    .join(' ')

  return { ingredient, preparation }
}

/**
 * A description for this dish, or null when nothing here fits.
 *
 * @returns {{description: string, source: 'exact'|'pattern'} | null}
 */
function lookup(name) {
  const key = normalise(name)
  if (!key) return null

  if (EXACT[key]) return { description: EXACT[key], source: 'exact' }

  const { ingredient, preparation } = splitName(name)
  if (!ingredient || !preparation) return null

  const template = PREPARATIONS[preparation]
  if (!template) return null

  // A template that opens with the ingredient - "{x} simmered in a tangy
  // tamarind gravy" - produced "fish simmered in...", starting mid-sentence.
  const filled = template.replace('{x}', ingredient)

  return {
    description: filled.charAt(0).toUpperCase() + filled.slice(1),
    source: 'pattern',
  }
}

module.exports = { lookup, normalise, splitName, EXACT, PREPARATIONS, INGREDIENTS, SPELLINGS }
