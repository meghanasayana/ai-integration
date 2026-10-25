const express = require('express')
const router = express.Router()
const restaurantController = require('../controllers/restaurant.controller')
const comboController = require('../controllers/combo.controller')
const { authenticate, requireRestaurantAdmin } = require('../middleware/auth')
const { uploadSingle } = require('../middleware/upload')

// All routes require restaurant admin role
router.use(authenticate, requireRestaurantAdmin)

// Profile
router.get('/profile', restaurantController.getProfile)
router.put('/profile', uploadSingle, restaurantController.updateProfile)

// Dashboard & QR
router.get('/dashboard', restaurantController.getDashboard)
router.get('/qr', restaurantController.getMyQRCode)

// Categories
router.get('/categories', restaurantController.listCategories)
router.post('/categories', restaurantController.createCategory)
router.put('/categories/:id', restaurantController.updateCategory)
router.delete('/categories/:id', restaurantController.deleteCategory)

// Food items
router.get('/foods', restaurantController.listFoods)
router.get('/foods/:id', restaurantController.getFood)
router.post('/foods', uploadSingle, restaurantController.createFood)
router.put('/foods/:id', uploadSingle, restaurantController.updateFood)
router.delete('/foods/:id', restaurantController.deleteFood)
router.patch('/foods/:id/availability', restaurantController.toggleAvailability)

// Combos
router.get('/combos', comboController.listCombos)
router.get('/combos/:id', comboController.getCombo)
router.post('/combos', comboController.createCombo)
router.put('/combos/:id', comboController.updateCombo)
router.delete('/combos/:id', comboController.deleteCombo)
router.patch('/combos/:id/availability', comboController.toggleAvailability)

module.exports = router
