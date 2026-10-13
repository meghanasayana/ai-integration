'use strict'

/**
 * The closed catalogue of things the assistant is allowed to ask for.
 *
 * The AI never emits SQL, a query, or a field name. It picks one action from
 * this list and fills in its arguments. Anything outside the list is rejected
 * before it reaches any code that can touch the database.
 *
 * `writes`            - changes data, so it always needs confirmation
 * `destructive`       - irreversible, so it needs an exact match too
 * `required`/`optional` - argument contract, enforced by intentSchema.js
 */

const COMMANDS = {
  show_menu: {
    writes: false,
    destructive: false,
    required: [],
    optional: ['categoryName'],
    describe: () => 'Show the menu',
  },

  create_category: {
    writes: true,
    destructive: false,
    required: ['categoryName'],
    optional: [],
    describe: (a) => `Create the category "${a.categoryName}"`,
  },

  add_dish: {
    writes: true,
    destructive: false,
    required: ['dishName'],
    optional: ['categoryName', 'price', 'portions'],
    describe: (a) => `Add the dish "${a.dishName}"`,
  },

  update_price: {
    writes: true,
    destructive: false,
    required: ['dishName', 'price'],
    optional: ['portion'],
    describe: (a) =>
      a.portion
        ? `Change the ${a.portion} price of "${a.dishName}"`
        : `Change the price of "${a.dishName}"`,
  },

  set_availability: {
    writes: true,
    destructive: false,
    required: ['dishName', 'isAvailable'],
    optional: [],
    describe: (a) =>
      `Mark "${a.dishName}" as ${a.isAvailable ? 'available' : 'sold out'}`,
  },

  move_dish: {
    writes: true,
    destructive: false,
    required: ['dishName', 'categoryName'],
    optional: [],
    describe: (a) => `Move "${a.dishName}" into "${a.categoryName}"`,
  },

  delete_dish: {
    writes: true,
    destructive: true,
    required: ['dishName'],
    optional: [],
    describe: (a) => `Delete the dish "${a.dishName}"`,
  },
}

const ACTION_NAMES = Object.keys(COMMANDS)

module.exports = { COMMANDS, ACTION_NAMES }
