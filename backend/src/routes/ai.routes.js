const express = require('express')
const router = express.Router()

const { testAI } = require('../controllers/ai.controller')
const { authenticate, requireRestaurantAdmin } = require('../middleware/auth')

router.use(authenticate, requireRestaurantAdmin)

router.post('/test', testAI)

module.exports = router
