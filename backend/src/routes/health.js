const express = require('express');
const mongoose = require('mongoose');
const { version } = require('../../package.json');

const router = express.Router();

router.get('/', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const statusCode = mongoStatus === 'connected' ? 200 : 503;
  res.status(statusCode).json({
    status: mongoStatus === 'connected' ? 'ok' : 'degraded',
    mongo: mongoStatus,
    version,
  });
});

module.exports = router;
