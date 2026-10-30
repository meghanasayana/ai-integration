'use strict'

const express = require('express')
const router = express.Router()

const { authenticate, requireRestaurantAdmin } = require('../middleware/auth')
const controller = require('../controllers/dishDescriptions.controller')

router.use(authenticate, requireRestaurantAdmin)

router.get('/status', controller.status)
router.post('/start', controller.start)
router.post('/stop', controller.stop)
// A description written by hand for a dish the model could not place.
// Three options for a dish the automatic pass left blank.
router.post('/:dishId/suggest', controller.suggest)
router.patch('/:dishId', controller.write)

module.exports = router
