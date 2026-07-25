Component({
  data: {
    selected: 0,
    tabs: [
      {
        pagePath: '/pages/map/map',
        text: '地图',
        iconPath: '/assets/tabs/ditu_tab_ditu_weixuan.png',
        selectedIconPath: '/assets/tabs/ditu_tab_ditu_xuanzhong.png'
      },
      {
        pagePath: '/pages/favorites/favorites',
        text: '我的',
        iconPath: '/assets/tabs/wode_tab_wode_weixuan.png',
        selectedIconPath: '/assets/tabs/wode_tab_wode_xuanzhong.png'
      }
    ]
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab || index === this.data.selected) {
        return;
      }

      wx.switchTab({
        url: tab.pagePath
      });
    }
  }
});
