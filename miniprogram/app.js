App({
  globalData: {
    cloudReady: false,
    navMetrics: null
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        traceUser: true
      });
      this.globalData.cloudReady = true;
    }
  },

  getNavMetrics() {
    if (this.globalData.navMetrics) {
      return this.globalData.navMetrics;
    }

    const systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
    const statusBarHeight = systemInfo.statusBarHeight || 24;
    let capsuleReserve = 104;
    let navBarHeight = 44;

    if (wx.getMenuButtonBoundingClientRect) {
      const capsule = wx.getMenuButtonBoundingClientRect();
      if (capsule && capsule.top) {
        navBarHeight = capsule.height + (capsule.top - statusBarHeight) * 2;
        capsuleReserve = Math.max(systemInfo.windowWidth - capsule.left + 8, 96);
      }
    }

    this.globalData.navMetrics = {
      statusBarHeight,
      navBarHeight,
      topOffset: statusBarHeight + navBarHeight,
      capsuleReserve
    };

    return this.globalData.navMetrics;
  }
});
