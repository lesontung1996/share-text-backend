const express = require('express');
const router = express.Router();
const db = require('../db');

/* GET users listing. */
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM shared_texts');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving data");
  }
});

module.exports = router;
