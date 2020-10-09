/*
  Copyright 2017 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

define([
  "calcite",
  "dojo/_base/declare",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/_base/Color",
  "dojo/colors",
  "dojo/number",
  "dojo/date/locale",
  "dojo/on",
  "dojo/query",
  "dojo/dom",
  "dojo/dom-class",
  "dojo/dom-construct",
  "esri/identity/IdentityManager",
  "esri/request",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/PopupTemplate",
  "esri/layers/Layer",
  "esri/layers/GraphicsLayer",
  "esri/layers/FeatureLayer",
  "esri/layers/support/RasterFunction",
  "esri/geometry/Extent",
  "esri/geometry/Multipoint",
  "esri/geometry/Polygon",
  "esri/geometry/geometryEngine",
  "esri/Graphic",
  "esri/symbols/support/symbolUtils",
  "esri/widgets/Feature",
  "esri/widgets/Slider",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/LayerList",
  "esri/widgets/Legend",
  "esri/widgets/ScaleBar",
  "esri/widgets/Compass",
  "esri/widgets/BasemapGallery",
  "esri/widgets/Expand"
], function(calcite, declare, ApplicationBase, i18n, itemUtils, domHelper,
            Color, colors, number, locale, on, query, dom, domClass, domConstruct,
            IdentityManager, esriRequest, Evented, watchUtils, promiseUtils, Portal,
            PopupTemplate, Layer, GraphicsLayer, FeatureLayer, RasterFunction,
            Extent, Multipoint, Polygon, geometryEngine, Graphic, symbolUtils,
            Feature, Slider, Home, Search, LayerList, Legend, ScaleBar, Compass, BasemapGallery, Expand){

  return declare([Evented], {

    /**
     *
     */
    constructor: function(){
      this.CSS = {
        loading: "configurable-application--loading"
      };
      this.base = null;

      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function(base){
      if(!base){
        console.error("ApplicationBase is not defined");
        return;
      }
      this.base = base;

      domHelper.setPageLocale(this.base.locale);
      domHelper.setPageDirection(this.base.direction);

      const webMapItems = this.base.results.webMapItems;
      const webSceneItems = this.base.results.webSceneItems;
      const validItems = webMapItems.concat(webSceneItems).map(response => {
        return response.value;
      });
      const firstItem = (validItems && validItems.length) ? validItems[0] : null;
      if(!firstItem){
        console.error("Could not load an item to display");
        return;
      }

      this.base.config.title = (this.base.config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(this.base.config.title);

      const viewProperties = itemUtils.getConfigViewProperties(this.base.config);
      viewProperties.container = "view-container";
      viewProperties.constraints = { snapToZoom: true };

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: firstItem, appProxies: appProxies }).then(map => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then(view => {
          view.when(() => {
            this.viewReady(this.base.config, firstItem, view).then(() => {
              domClass.remove(document.body, this.CSS.loading);
            }).catch(console.error);
          });
        }, console.error);
      });
    },

    /**
     *
     * @param config
     * @param item
     * @param view
     */
    viewReady: function(config, item, view){

      // TITLE //
      dom.byId("app-title-node").innerHTML = config.title;

      // LOADING //
      const updating_node = domConstruct.create("div", { className: "view-loading-node loader" });
      domConstruct.create("div", { className: "loader-bars" }, updating_node);
      domConstruct.create("div", { className: "loader-text font-size--3 text-white", innerHTML: "Updating..." }, updating_node);
      view.ui.add(updating_node, "bottom-right");
      watchUtils.init(view, "updating", (updating) => {
        domClass.toggle(updating_node, "is-active", updating);
      });

      // USER SIGN IN //
      return this.initializeUserSignIn().catch(console.warn).then(() => {

        // POPUP DOCKING OPTIONS //
        view.popup.dockEnabled = true;
        view.popup.dockOptions = {
          buttonEnabled: false,
          breakpoint: false,
          position: "top-right"
        };

        const _getWaterLevel = options => {
          return this.getWaterLevel(options.graphic.geometry).then(waterLevel => {
            if(waterLevel){
              return domConstruct.create("div", {
                className: "font-size-0",
                innerHTML: `This location will be affected by <span class="text-red">${waterLevel} feet</span> of sea level rise.`
              });
            } else {
              return domConstruct.create("div", {
                className: "text-green",
                innerHTML: `This location will NOT be affected by the analysis maximum of 10 feet of sea level rise.`
              });
            }
          });
        };

        // SEARCH //
        const search = new Search({
          view: view,
          popupEnabled: true,
          locationEnabled: false,
          popupTemplate: {
            title: "{Match_addr}",
            content: _getWaterLevel
          },
          searchTerm: "Intracoastal City, LA, USA"
        });
        const searchExpand = new Expand({
          view: view,
          content: search,
          expanded: true,
          expandIconClass: "esri-icon-search",
          expandTooltip: "Search"
        });
        view.ui.add(searchExpand, { position: "top-left", index: 0 });

        view.popup.autoOpenEnabled = false;
        view.on("click", clickEvt => {
          view.hitTest(clickEvt).then(hitResponse => {
            const hitResult = hitResponse.results.find(hitResult => {
              return (hitResult.graphic && hitResult.graphic.layer && this.isAssetLayer(hitResult.graphic.layer))
            });
            if(hitResult){
              view.popup.open({ features: [hitResult.graphic] });
            } else {
              search.search([clickEvt.mapPoint.longitude, clickEvt.mapPoint.latitude]);
            }
          });
        });


        watchUtils.init(search.viewModel, "state", state => {
          if(state === "ready"){
            const defaultZoomScale = view.scale;
            const defaultSource = search.defaultSources.getItemAt(0);
            defaultSource.set({ zoomScale: defaultZoomScale });
          }
        });


        // HOME //
        const home = new Home({ view: view });
        view.ui.add(home, { position: "top-left", index: 1 });

        // APPLICATION READY //
        this.applicationReady(view);


      });

    },

    /**
     *
     * @returns {*}
     */
    initializeUserSignIn: function(){

      const checkSignInStatus = () => {
        return IdentityManager.checkSignInStatus(this.base.portal.url).then(userSignIn).catch(userSignOut).then();
      };
      IdentityManager.on("credential-create", checkSignInStatus);

      // SIGN IN NODE //
      const signInNode = document.getElementById("sign-in-node");
      const userNode = document.getElementById("user-node");

      // UPDATE UI //
      const updateSignInUI = () => {
        if(this.base.portal.user){
          document.getElementById("user-firstname-node").innerHTML = this.base.portal.user.fullName.split(" ")[0];
          document.getElementById("user-fullname-node").innerHTML = this.base.portal.user.fullName;
          document.getElementById("username-node").innerHTML = this.base.portal.user.username;
          document.getElementById("user-thumb-node").src = this.base.portal.user.thumbnailUrl;
          signInNode.classList.add('hide');
          userNode.classList.remove('hide');
        } else {
          signInNode.classList.remove('hide');
          userNode.classList.add('hide');
        }
        return promiseUtils.resolve();
      };

      // SIGN IN //
      const userSignIn = () => {
        this.base.portal = new Portal({ url: this.base.config.portalUrl, authMode: "immediate" });
        return this.base.portal.load().then(() => {
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).catch(console.warn).then();
      };

      // SIGN OUT //
      const userSignOut = () => {
        IdentityManager.destroyCredentials();
        this.base.portal = new Portal({});
        return this.base.portal.load().then(() => {
          this.base.portal.user = null;
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).catch(console.warn).then();

      };

      // USER SIGN IN //
      signInNode.addEventListener("click", userSignIn);

      // SIGN OUT NODE //
      const signOutNode = document.getElementById("sign-out-node");
      if(signOutNode){
        signOutNode.addEventListener("click", userSignOut);
      }

      return checkSignInStatus();
    },


    /**
     * APPLICATION READY
     *
     *  - https://coast.noaa.gov/slr/
     *    - MHHW = Current Mean Higher High Water
     *
     *  - https://coast.noaa.gov/arcgis/rest/services/
     *
     * @param view
     */
    applicationReady: function(view){

      //
      // HIGHLIGHT OPTIONS //
      //
      view.highlightOptions = {
        color: Color.named.red,
        fillOpacity: 0.3,
        haloColor: Color.named.red,
        haloOpacity: 0.8
      };

      // ANALYSIS MIN SCALE //
      this.analysisMinScale = view.scale; //144447.638572

      this.initializeAreasOfInterest(view);

      // WATER LEVEL SLIDER //
      this.initializeWaterLevelSlider(view).then(slrSliderContainer => {
        // ASSETS LAYER //
        this.initializeAssetLayers(view).then(() => {

          // WHEN VIEW FINISHES UPDATING THE FIRST TIME //
          // watchUtils.whenNotOnce(view, "updating", () => {
            // SET INITIAL SLR WATER LEVEL //
            this.setWaterLevel(0);
            // ENABLE SLR SLIDER //
            domClass.remove(slrSliderContainer, "btn-disabled");
          // });

        });
      });

    },

    /**
     *
     * @param view
     */
    initializeAreasOfInterest: function(view){

      //
      // LOCATIONS OF INTEREST
      //
      const aoiLayer = view.map.layers.find(layer => {
        return (layer.title === "Scenario Locations");
      });
      aoiLayer.load().then(() => {

        const scenarioLocationsSelect = dom.byId("scenario-locations-select");

        const locationsQuery = aoiLayer.createQuery();
        locationsQuery.set({ orderByFields: ["Label ASC"] });
        aoiLayer.queryFeatures(locationsQuery).then(aoiFS => {

          let playEnabled = false;
          const pauseDuration = 6000;

          const goToSelectedScenarioLocation = () => {
            const aoiFeature = aoiFeatureByLabel.get(scenarioLocationsSelect.value);
            view.goTo({ target: aoiFeature, zoom: 14 }, { animate: false }).then(() => {
              watchUtils.whenTrueOnce(view, "updating", () => {
                watchUtils.whenFalseOnce(view, "updating", () => {
                  if(playEnabled){
                    setTimeout(() => {
                      if(playEnabled){
                        selectNextScenarioLocation();
                        window.requestAnimationFrame(goToSelectedScenarioLocation);
                      }
                    }, pauseDuration);
                  }
                });
              });
            });
          };

          const aoiFeatureByLabel = aoiFS.features.reduce((list, aoiFeature) => {
            const locationLabel = aoiFeature.attributes.Label;
            domConstruct.create("option", {
              innerHTML: locationLabel,
              value: locationLabel
            }, scenarioLocationsSelect);
            return list.set(locationLabel, aoiFeature);
          }, new Map());

          on(scenarioLocationsSelect, "change", () => {
            goToSelectedScenarioLocation();
          });

          const selectNextScenarioLocation = () => {
            if(scenarioLocationsSelect.selectedIndex < (scenarioLocationsSelect.length - 1)){
              scenarioLocationsSelect.selectedIndex += 1;
            } else {
              scenarioLocationsSelect.selectedIndex = 0;
            }
          };

          const playPauseBtn = dom.byId("play-pause-btn");
          on(playPauseBtn, "click", () => {
            domClass.toggle(playPauseBtn, "icon-ui-play icon-ui-pause");
            playEnabled = domClass.contains(playPauseBtn, "icon-ui-pause");
            if(playEnabled){
              selectNextScenarioLocation();
              window.requestAnimationFrame(goToSelectedScenarioLocation);
            }
          });

        });
      });

    },

    /**
     *
     * @param layer
     * @param currentScale
     * @returns {boolean}
     */
    /*isLayerOutsideScaleRange: function(layer, currentScale){
      if(!layer || isNaN(currentScale)){
        return false;
      }

      const min = layer.minScale;
      const max = layer.maxScale;

      const isOutsideMinScale = !isNaN(min) && min > 0 && currentScale > min;
      const isOutsideMaxScale = !isNaN(max) && max > 0 && currentScale < max;

      return isOutsideMinScale || isOutsideMaxScale;
    },*/

    /**
     *
     * @param view
     */
    initializeWaterLevelSlider: function(view){

      const waterLevelLayer = view.map.layers.find(layer => {
        return (layer.title === "Sea Level Rise Water Level");
      });
      return waterLevelLayer.load().then(() => {

        this.initializeWaterLevelInfo(waterLevelLayer);

        //
        // COLD TO HOT COLORRAMP //
        //
        const coldToHotColorramp = {
          "ColorrampName": "Cold to Hot Diverging"
        };

        //
        // DEFAULT COLORRAMP //
        //  - #002673  #002673  #004CA8  #006EFF  #BFE9FF //
        //
        const defaultColorramp = {
          "Colorramp": {
            "type": "multipart",
            "colorRamps": [
              {
                "type": "algorithmic",
                "fromColor": [0, 38, 115, 1.0],
                "toColor": [0, 38, 115, 1.0],
                "algorithm": "esriCIELabAlgorithm"
              },
              {
                "type": "algorithmic",
                "fromColor": [0, 38, 115, 1.0],
                "toColor": [0, 76, 168, 1.0],
                "algorithm": "esriCIELabAlgorithm"
              },
              {
                "type": "algorithmic",
                "fromColor": [0, 76, 168, 1.0],
                "toColor": [0, 110, 255, 1.0],
                "algorithm": "esriCIELabAlgorithm"
              },
              {
                "type": "algorithmic",
                "fromColor": [0, 110, 255, 1.0],
                "toColor": [191, 233, 255, 1.0],
                "algorithm": "esriCIELabAlgorithm"
              }
            ]
          }
        };

        // WATER LEVEL STATS //
        const waterLevelStats = [0, 10, 1.2000194178044574, 2.5030869494456796];

        const updateWaterLevelLayer = (maxWaterLevel) => {

          const maskFunction = new RasterFunction({
            "functionName": "Mask",
            "functionArguments": {
              //"NoDataValues": (maxWaterLevel > 0) ? [] : [0],
              "IncludedRanges": [0, maxWaterLevel],
              "NoDataInterpretation": -1
            },
            "outputPixelType": "u8"
          });

          const stretchFunction = new RasterFunction({
            "functionName": "Stretch",
            "functionArguments": {
              "StretchType": 3,
              "NumberOfStandardDeviations": 2.5,
              "Statistics": [waterLevelStats],
              "UseGamma": true,
              "Gamma": [1.25],
              "Raster": maskFunction
            }
          });

          // UPDATE RENDERING RULE //
          waterLevelLayer.renderingRule = new RasterFunction({
            "functionName": "Colormap",
            "functionArguments": {
              "Raster": stretchFunction,
              ...defaultColorramp
            }
          });

        };

        // LABEL FORMATTER //
        const feetLabel = (value, type, index) => {
          let label = `${value} ft`;
          switch(type){
            case "max":
              label = "Water Level";
              break;
            case "value":
              switch(value){
                case 0:
                  label = "MHHW";
                  break;
                case 1:
                  label = "1 foot";
                  break;
                default:
                  label = `${value} feet`;
              }
              break;
            case "min":
              label = "Current Mean Higher High Water";
              break;
          }
          return label;
        };

        //
        // SLR SLIDER //
        //
        const slrSliderContainer = dom.byId("slr-slider");
        const slrSlider = new Slider({
          container: slrSliderContainer,
          min: 0,
          max: 10,
          precision: 0,
          steps: 1,
          values: [0],
          tickConfigs: [{
            labelsVisible: true,
            mode: "count",
            values: 11,
            labelFormatFunction: feetLabel
          }],
          layout: "vertical",
          visibleElements: { labels: true, rangeLabels: true },
          labelFormatFunction: feetLabel
        });

        // const legend = new Legend({ view: view, layerInfos: [{ layer: slrLayers.getItemAt(10) }] });
        // view.ui.add(legend, "top-right");

        // SET WATER LEVEL //
        this.setWaterLevel = (waterLevel) => {
          updateWaterLevelLayer(waterLevel);
          this.emit("slr-change", { waterLevel: waterLevel });
        };

        // SLR SLIDER VALUE CHANGED //
        slrSlider.watch("values", values => {
          this.setWaterLevel(values[0]);
        });

        return slrSliderContainer;
      });
    },

    /**
     *
     * @param view
     */
    initializeAssetLayers: function(view){

      const assetsList = dom.byId("assets-list");
      const itemsList = dom.byId("items-list");
      const backLink = dom.byId("back-link");
      const assetTitle = dom.byId("asset-title");
      const selectAll = dom.byId("select-all");
      const selectNode = dom.byId("select-none");

      this.enableFeaturesList = assetLayerTitle => {
        if(assetLayerTitle != null){
          assetTitle.innerHTML = assetLayerTitle;
          domClass.add(assetsList, "hide");
          domClass.remove(itemsList, "hide");
          domClass.remove(backLink, "btn-disabled");
        } else {
          assetTitle.innerHTML = "";
          domClass.remove(assetsList, "hide");
          domClass.add(itemsList, "hide");
          domClass.add(backLink, "btn-disabled");
        }
      };

      on(backLink, "click", () => {
        this.enableFeaturesList();
      });

      on(selectAll, "click", () => {
        query(".status-left-items").forEach(node => {
          if(domClass.contains(query(".icon-ui-dark-blue", node)[0], "icon-ui-checkbox-unchecked")){
            node.click();
          }
        });
      });

      on(selectNode, "click", () => {
        query(".status-left-items").forEach(node => {
          if(domClass.contains(query(".icon-ui-dark-blue", node)[0], "icon-ui-checkbox-checked")){
            node.click();
          }
        });
      });


      this.on("analysis-status", options => {
        switch(options.status){
          case "suspended":
          case "not suspended":
            domClass.toggle(view.container, "is-active", false);
            this.enableFeaturesList();
            break;
          case "start":
            domClass.toggle(view.container, "is-active", true);
            this.enableFeaturesList();
            break;
          case "end":
            domClass.toggle(view.container, "is-active", view.updating);
            break;
        }
      });


      const assetLayerKey = "US HIFLD Assets - ";
      this.ASSETS_LAYERS = view.map.layers.filter(layer => {
        return layer.title.startsWith(assetLayerKey);
      });

      this.isAssetLayer = layer => {
        return (this.ASSETS_LAYERS.find(assetLayer => {
          return (layer.id === assetLayer.id);
        }) != null);
      };

      const layerLoadedHandles = this.ASSETS_LAYERS.map((assetLayer, assetLayerIdx) => {
        assetLayer.title = assetLayer.title.replace(new RegExp(assetLayerKey), "").replace(/_/g, " ");
        return this.initializeAssetLayer(view, assetLayer, "first");
      });


      // RETURN WHEN ALL ASSET LAYERS HAVE LOADED //
      return promiseUtils.eachAlways(layerLoadedHandles);
    },

    /**
     *
     * @param view
     * @param assetLayer
     * @param placement
     */
    initializeAssetLayer: function(view, assetLayer, placement){

      const assetsList = dom.byId("assets-list");
      const itemsList = dom.byId("items-list");

      const statusNode = domConstruct.create("div", { className: "status-node side-nav-link font-size-0 btn-disabled" }, assetsList, placement || "last");

      const leftItems = domConstruct.create("span", { className: "status-left-items" }, statusNode);
      const visibilityNode = domConstruct.create("span", { className: "icon-ui-dark-blue" }, leftItems);
      domClass.toggle(visibilityNode, "icon-ui-checkbox-checked", assetLayer.visible);
      domClass.toggle(visibilityNode, "icon-ui-checkbox-unchecked", !assetLayer.visible);

      const symbolNode = domConstruct.create("span", { className: "status-symbol-node margin-right-half" }, leftItems);
      const defaultSymbol = (assetLayer.renderer.type === "simple") ? assetLayer.renderer.symbol : (assetLayer.renderer.defaultSymbol || assetLayer.renderer.uniqueValueInfos[0].symbol);
      symbolUtils.renderPreviewHTML(defaultSymbol, { node: symbolNode, size: 16 });

      const titleNode = domConstruct.create("span", { className: "", innerHTML: assetLayer.title }, leftItems);

      const rightItems = domConstruct.create("span", { className: "" }, statusNode);
      const countNode = domConstruct.create("span", { className: "avenir-demi right", innerHTML: "--" }, rightItems);
      const itemListNode = domConstruct.create("span", { title: "View list of affected assets...", className: "icon-ui-description right hide" }, rightItems);


      const clearStatusUI = () => {
        countNode.innerHTML = "--";
        domClass.remove(statusNode, "text-red");
        domClass.add(itemListNode, "hide");
      };

      return assetLayer.load().then(() => {

        assetLayer.outFields = ["*"];
        assetLayer.popupEnabled = true;
        assetLayer.minScale = this.analysisMinScale;

        const objectIdField = assetLayer.objectIdField;

        return view.whenLayerView(assetLayer).then(assetLayerView => {
          domClass.remove(statusNode, "btn-disabled");

          watchUtils.init(assetLayerView, "suspended", suspended => {
            domClass.toggle(statusNode, "suspended", suspended);
          });

          let highlight = null;
          let waterLevel = 0;
          let affectedFeatures = null;


          const updateAnalysis = promiseUtils.debounce(() => {
            return promiseUtils.create((resolve, reject) => {

              clearStatusUI();

              if(!assetLayerView.suspended){
                watchUtils.whenFalseOnce(assetLayerView, "updating", () => {

                  assetLayerView.queryFeatures({
                    geometry: view.extent,
                    where: `water_level BETWEEN 0 AND ${waterLevel}`
                  }).then(affectedFS => {

                    affectedFeatures = affectedFS.features;
                    const affectedCount = affectedFeatures.length;
                    countNode.innerHTML = number.format(affectedCount);

                    domClass.toggle(statusNode, "text-red", (affectedCount > 0));
                    domClass.toggle(itemListNode, "hide", (affectedCount === 0));

                    highlight && highlight.remove();
                    const objectIds = affectedFeatures.map(f => f.attributes[objectIdField]);
                    highlight = assetLayerView.highlight(objectIds);

                    resolve();
                  });
                });
              }
            });
          });

          const _ignoreAbortErrors = error => {
            if(error.name !== 'AbortError'){ console.error(error); }
          }

          //
          //
          //
          on(leftItems, "click", leftItemsClickEvt => {
            leftItemsClickEvt && leftItemsClickEvt.stopPropagation();
            domClass.toggle(visibilityNode, "icon-ui-checkbox-checked icon-ui-checkbox-unchecked");
            assetLayer.visible = domClass.contains(visibilityNode, "icon-ui-checkbox-checked");
            updateAnalysis().catch(_ignoreAbortErrors);
          });

          //
          //
          //
          on(itemListNode, "click", itemListClickEvt => {
            itemListClickEvt && itemListClickEvt.stopPropagation();
            domConstruct.empty(itemsList);

            affectedFeatures.forEach(affectedFeature => {
              const itemNode = domConstruct.create("div", { className: "side-nav-link" }, itemsList);
              const featureInfo = new Feature({
                container: domConstruct.create("div", { className: "" }, itemNode),
                graphic: affectedFeature
              });
            });

            this.enableFeaturesList(assetLayer.title);
          });

          //
          //
          //
          this.on("slr-change", options => {
            waterLevel = options.waterLevel;
            updateAnalysis().catch(_ignoreAbortErrors);
          });


          //
          //
          //
          watchUtils.init(view, "stationary", stationary => {
            if(stationary){
              updateAnalysis();
            }
          });

        });
      });

    },

    /**
     *
     * @param waterLevelLayer
     */
    initializeWaterLevelInfo: function(waterLevelLayer){

      this.getWaterLevel = location => {

        return esriRequest(`${waterLevelLayer.url}/getSamples`, {
          query: {
            geometry: JSON.stringify(location.toJSON()),
            geometryType: "esriGeometryPoint",
            returnFirstValueOnly: true,
            pixelSize: "12,12",
            interpolation: "RSP_NearestNeighbor",
            f: "json"
          }
        }).then(samplesResponse => {
          const samples = samplesResponse.data.samples;
          if(samples.length){
            return Number(samples[0].value);
          } else {
            return null;
          }
        }, (error) => {
          return null;
        });
      };

    }

  });
});


/*polygonsToMultiPart: function(polygons){
  return new Polygon({
    spatialReference: polygons[0].spatialReference,
    rings: polygons.reduce((parts, polygon) => {
      return polygon ? parts.concat(polygon.rings) : [];
    }, [])
  });
}*/


// RESET ASSET LAYERS WATER LEVEL //
/*const resetAssetLayers = () => {
  this.ASSETS_LAYERS.map(assetLayer => {
    view.whenLayerView(assetLayer).then(assetLayerView => {
      assetLayer.queryFeatures({ geometry: view.extent, outFields: ["OBJECTID", "water_level"] }).then(affectedFS => {
        const updatedFeatureInfos = affectedFS.features.map((nullFeature, nullFeatureIdx) => {
          return {
            attributes: {
              "OBJECTID": nullFeature.attributes.OBJECTID,
              "water_level": null
            }
          }
        });
        assetLayer.applyEdits({ updateFeatures: updatedFeatureInfos }).then(applyEditsResults => {
          console.info("RESET: ", applyEditsResults);
          assetLayer.refresh();
        });
      });
    });
  });
};*/

// WATER LEVEL RESET BUTTON //
/* const resetBtn = dom.byId("reset-btn");
 const updateRestBtn = () => {
   if(this.base.portal.user == null){
     domClass.add(resetBtn, "hide");
   } else {
     domClass.toggle(resetBtn, "hide", !this.base.portal.user.username.startsWith("jgrayson"));
   }
 };
 this.on("portal-user-change", updateRestBtn);
 on(resetBtn, "click", resetAssetLayers);
 updateRestBtn();*/

//const nullFeatureList = new Map();
/*const updateNullFeatures = () => {
         //if(assetLayer.visible && !this.isLayerOutsideScaleRange(assetLayer, view.scale)){
         if(!assetLayerView.suspended){
           return watchUtils.whenFalseOnce(assetLayerView, "updating").then(() => {

             const featuresQuery = assetLayerView.createQuery();
             featuresQuery.set({
               geometry: view.extent,
               where: "water_level IS NULL",
               returnGeometry: true
             });
             return assetLayerView.queryFeatures(featuresQuery).then(featureSet => {
               if(featureSet.features.length){

                 featureSet.features.forEach(feature => {
                   const oid = feature.attributes.OBJECTID;
                   if(!nullFeatureList.has(oid)){
                     nullFeatureList.set(oid, feature);
                   }
                 });

                 const nullFeatures = Array.from(nullFeatureList.values());
                 if(nullFeatures.length){

                   return this.analyzeWaterLevel({ layer: assetLayer, nullFeatures: nullFeatures }).then(updatedOIDs => {
                     if(updatedOIDs.length){

                       updatedOIDs.forEach(updatedOID => {
                         nullFeatureList.delete(updatedOID);
                       });

                       return watchUtils.whenTrueOnce(assetLayerView, "updating").then(() => {
                         return watchUtils.whenFalseOnce(assetLayerView, "updating").then(() => {
                           return updatedOIDs.length;
                         });
                       });
                     } else {
                       nullFeatureList.clear();
                       return promiseUtils.resolve(0);
                     }
                   });

                 } else {
                   return 0;
                 }
               } else {
                 return 0;
               }
             });
           });
         } else {
           return promiseUtils.resolve(0);
         }
       };*/


/*initializeWaterLevelOverlay: function(view){

     const waterLevelLayer = view.map.layers.find(layer => {
       return (layer.title === "SLR Water Level");
     });
     if(waterLevelLayer){

       return waterLevelLayer.load().then(() => {

         this.analyzeWaterLevel = ({ layer, nullFeatures }) => {

           const queryGeometry = new Multipoint({
             spatialReference: { "wkid": view.spatialReference.wkid },
             points: nullFeatures.map(feature => {
               return [feature.geometry.x, feature.geometry.y]
             })
           });

           return esriRequest(`${waterLevelLayer.url}/getSamples`, {
             query: {
               geometry: JSON.stringify(queryGeometry.toJSON()),
               geometryType: "esriGeometryMultipoint",
               returnFirstValueOnly: true,
               pixelSize: "12,12",
               interpolation: "RSP_NearestNeighbor",
               f: "json"
             }
           }).then(samplesResponse => {
             //console.info("getSamples: ", layer.title, nullFeatures.length);

             const samples = samplesResponse.data.samples;
             const samplesByIndex = samples.reduce((list, sample) => {
               return list.set(sample.locationId, sample);
             }, new Map());

             const updatedFeatureInfos = nullFeatures.map((nullFeature, nullFeatureIdx) => {
               const sample = samplesByIndex.get(nullFeatureIdx);
               return {
                 attributes: {
                   "OBJECTID": nullFeature.attributes.OBJECTID,
                   "water_level": sample ? Number(sample.value) : -1
                 }
               }
             });

             return layer.applyEdits({ updateFeatures: updatedFeatureInfos }).then(applyEditsResults => {
               return applyEditsResults.updateFeatureResults.map(updatedFeature => {
                 return updatedFeature.objectId;
               });
             });

           }, (error) => {
             //console.error("Error getSamples: ", layer.title, nullFeatures.length, error);

             const updatedFeatureInfos = nullFeatures.map((nullFeature, nullFeatureIdx) => {
               return {
                 attributes: {
                   "OBJECTID": nullFeature.attributes.OBJECTID,
                   "water_level": -1
                 }
               }
             });

             return layer.applyEdits({ updateFeatures: updatedFeatureInfos }).then(applyEditsResults => {
               return applyEditsResults.updateFeatureResults.map(updatedFeature => {
                 return updatedFeature.objectId;
               });
             });
           });
         };

       });
     } else {
       return promiseUtils.resolve();
     }
   }*/
