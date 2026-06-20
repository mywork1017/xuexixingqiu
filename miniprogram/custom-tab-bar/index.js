Component({
  data: {
    selected: 0,
    tabs: [
      {
        pagePath: '/pages/map/map',
        text: '地图',
        iconPath: '/assets/tabs/map.png',
        selectedIconPath: '/assets/tabs/map-active.png'
      },
      {
        pagePath: '/pages/favorites/favorites',
        text: '我的',
        iconPath: '/assets/tabs/favorite.png',
        selectedIconPath: '/assets/tabs/favorite-active.png'
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
