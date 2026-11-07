'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('universalExample', {
  platform: process.platform,
});
