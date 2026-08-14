(() => {
  'use strict';

  if (!window.Chart) return;

  const hasSelection = key =>
    document.querySelector(`.multi-filter[data-filter="${key}"]`)?.classList.contains('has-selection') || false;

  const sumDatasets = datasets => {
    const length = Math.max(0, ...datasets.map(ds => Array.isArray(ds.data) ? ds.data.length : 0));
    return Array.from({ length }, (_, index) =>
      datasets.reduce((total, ds) => total + (Number(ds.data?.[index]) || 0), 0)
    );
  };

  const filteredSeriesPlugin = {
    id: 'panelFilteredSeries',
    beforeInit(chart) {
      if (chart?.canvas?.id !== 'spendChart') return;

      const datasets = chart.config?.data?.datasets || [];
      if (!datasets.length) return;

      const categoryFiltered = hasSelection('category');
      const subcategoryFiltered = hasSelection('subcategory');
      const dimensionFiltered = categoryFiltered || subcategoryFiltered;

      if (dimensionFiltered) {
        // Cuando el usuario filtra, mostrar únicamente las series seleccionadas.
        chart.config.data.datasets = datasets.filter(ds => ds.label !== 'Total seleccionado');
        return;
      }

      // Sin filtro de categoría/subcategoría: una sola serie consolidada “Todos”.
      const totalDataset = datasets.find(ds => ds.label === 'Total seleccionado');
      if (totalDataset) {
        chart.config.data.datasets = [{
          ...totalDataset,
          label: 'Todos',
          borderDash: [],
          borderWidth: 2
        }];
        return;
      }

      const base = datasets[0];
      chart.config.data.datasets = [{
        ...base,
        label: 'Todos',
        data: sumDatasets(datasets),
        borderColor: '#1769ff',
        backgroundColor: '#1769ff',
        borderDash: [],
        borderWidth: 2
      }];
    }
  };

  window.Chart.register(filteredSeriesPlugin);
})();
