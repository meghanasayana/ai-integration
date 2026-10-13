'use strict'

const express = require('express')
const router = express.Router()

const { authenticate, requireRestaurantAdmin } = require('../middleware/auth')
const menuAssistantController = require('../controllers/menuAssistant.controller')

// Same gate as every other restaurant-admin route.
router.use(authenticate, requireRestaurantAdmin)

router.post('/ask', menuAssistantController.ask)

module.exports = router
