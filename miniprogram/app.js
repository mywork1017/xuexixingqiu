App({
  globalData: {
    cloudReady: false
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        traceUser: true
      });
      this.globalData.cloudReady = true;
    }
  }
});
