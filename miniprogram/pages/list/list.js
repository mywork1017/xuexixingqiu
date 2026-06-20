const {
  CATEGORY_OPTIONS,
  filterPlaces,
  normalizePlace
} = require('../../utils/place-utils');
const { SAMPLE_PLACES } = require('../../utils/sample-places');

Page({
  data: {
    categories: ['全部'].concat(CATEGORY_OPTIONS),
    activeCategory: '全部',
    places: [],
    filteredPlaces: []
  },

  onLoad(options) {
    const category = decodeURIComponent(options.category || '全部');
    const cachedPlaces = wx.getStorageSync('places');
    const places = Array.isArray(cachedPlaces) && cachedPlaces.length ? cachedPlaces : SAMPLE_PLACES;
    this.applyPlaces(places, category);
  },

  applyPlaces(rawPlaces, category) {
    const places = rawPlaces.map(normalizePlace);
    const filteredPlaces = filterPlaces(places, category);

    this.setData({
      places,
      filteredPlaces,
      activeCategory: category
    });
  },

  selectCategory(event) {
    const category = event.currentTarget.dataset.category;
    this.applyPlaces(this.data.places, category);
  },

  goToDetail(event) {
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}`
    });
  }
});
