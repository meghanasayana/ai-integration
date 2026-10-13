const prisma = require('../lib/prisma')

const testAI = async (req, res) => {
  try {
    const userPrompt = req.body.prompt?.trim()

    if (!userPrompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required',
      })
    }

    const prompt = `
You are an AI assistant for a restaurant admin system.

Understand the restaurant admin's request and return ONLY valid JSON.

Allowed actions:
show_menu
add_food
update_food
delete_food
availability
create_category
update_category
unknown

For availability changes, return:
{
  "action": "availability",
  "foodName": "exact or closest food name",
  "isAvailable": true or false
}

For other actions, return the action and relevant fields.

User request:
${userPrompt}
`

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen3-vl:4b',
        prompt,
        stream: false,
        format: 'json',
      }),
    })

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`)
    }

    const data = await response.json()

    let aiResult

    try {
      aiResult = JSON.parse(data.response)
    } catch {
      return res.status(500).json({
        success: false,
        error: 'AI returned invalid JSON',
        raw: data.response,
      })
    }

    // Show menu
    if (aiResult.action === 'show_menu') {
      const foods = await prisma.foodItem.findMany({
        where: {
          restaurantId: req.user.restaurantId,
        },
        select: {
          id: true,
          name: true,
          price: true,
          isAvailable: true,
          isVeg: true,

          portions: {
            select: {
              id: true,
              portion: true,
              price: true,
              isAvailable: true,
            },
          },

          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [
          { sortOrder: 'asc' },
          { createdAt: 'desc' },
        ],
      })

      return res.json({
        success: true,
        action: 'show_menu',
        foods,
      })
    }

    // Change food availability
    if (aiResult.action === 'availability') {
      if (!aiResult.foodName) {
        return res.status(400).json({
          success: false,
          error: 'Food name was not identified',
        })
      }

      const foods = await prisma.foodItem.findMany({
        where: {
          restaurantId: req.user.restaurantId,
        },
        select: {
          id: true,
          name: true,
          isAvailable: true,
        },
      })

      const searchName = aiResult.foodName.toLowerCase()

      const food = foods.find(
        (item) =>
          item.name.toLowerCase() === searchName ||
          item.name.toLowerCase().includes(searchName) ||
          searchName.includes(item.name.toLowerCase())
      )

      if (!food) {
        return res.status(404).json({
          success: false,
          error: `Food item "${aiResult.foodName}" not found`,
        })
      }

      const updated = await prisma.foodItem.update({
        where: {
          id: food.id,
        },
        data: {
          isAvailable: Boolean(aiResult.isAvailable),
        },
        select: {
          id: true,
          name: true,
          price: true,
          isAvailable: true,
        },
      })

      return res.json({
        success: true,
        action: 'availability',
        message: `${updated.name} is now ${
          updated.isAvailable ? 'available' : 'unavailable'
        }.`,
        food: updated,
      })
    }

    return res.json({
      success: true,
      action: aiResult.action || 'unknown',
      response: aiResult,
    })
  } catch (error) {
    console.error('[AI]', error)

    return res.status(500).json({
      success: false,
      error: error.message,
    })
  }
}

module.exports = { testAI }