'use strict'

const express = require('express')
const router = express.Router()

const { authenticate, requireRestaurantAdmin } = require('../middleware/auth')
const { menuUpload } = require('../middleware/menuUpload')
const menuImportController = require('../controllers/menuImport.controller')

// Same gate as every other restaurant-admin route.
router.use(authenticate, requireRestaurantAdmin)

router.post('/extract', menuUpload, menuImportController.extract)
router.post('/extract-text', menuImportController.extractText)
router.post('/commit', menuImportController.commit)

// Emptying the menu. The restaurant comes from the session, never the body.
router.get('/summary', menuImportController.summary)
router.delete('/all', menuImportController.clearMenu)

module.exports = router
