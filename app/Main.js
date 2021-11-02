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
  "dojo/dom-construct",
  "esri/identity/IdentityManager",
  "esri/request",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/layers/support/RasterFunction",
  "esri/symbols/support/symbolUtils",
  "esri/widgets/Feature",
  "esri/widgets/Slider",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/Legend",
  "esri/widgets/Expand"
], function(calcite, declare, ApplicationBase, i18n, itemUtils, domHelper, domConstruct,
            IdentityManager, esriRequest, Evented, watchUtils, promiseUtils,
            Portal, RasterFunction, symbolUtils,
            Feature, Slider, Home, Search, Legend, Expand){

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
              document.body.classList.remove(this.CSS.loading);
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
      document.getElementById("app-title-node").innerHTML = config.title;

      // LOADING //
      const updatingNode = domConstruct.create("div", { className: "view-loading-node loader" });
      domConstruct.create("div", { className: "loader-bars" }, updatingNode);
      domConstruct.create("div", { className: "loader-text font-size--3 text-white", innerHTML: "Updating..." }, updatingNode);
      view.ui.add(updatingNode, "bottom-right");
      watchUtils.init(view, "updating", (updating) => {
        updatingNode.classList.toggle("is-active", updating);
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
        color: 'red',
        fillOpacity: 0.3,
        haloColor: 'red',
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
          slrSliderContainer.classList.remove("btn-disabled");
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
      const aoiLayer = view.map.layers.find(layer => { return (layer.title === "Scenario Locations"); });
      aoiLayer.load().then(() => {

        const scenarioLocationsSelect = document.getElementById("scenario-locations-select");

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

          scenarioLocationsSelect.addEventListener("change", () => {
            goToSelectedScenarioLocation();
          });

          const selectNextScenarioLocation = () => {
            if(scenarioLocationsSelect.selectedIndex < (scenarioLocationsSelect.length - 1)){
              scenarioLocationsSelect.selectedIndex += 1;
            } else {
              scenarioLocationsSelect.selectedIndex = 0;
            }
          };

          const playPauseBtn = document.getElementById("play-pause-btn");
          playPauseBtn.addEventListener("click", () => {
            playPauseBtn.classList.toggle("icon-ui-play icon-ui-pause");
            playEnabled = playPauseBtn.classList.contains("icon-ui-pause");
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

      const waterLevelLayer = view.map.layers.find(layer => { return (layer.title === "Sea Level Rise Water Level"); });
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
        const slrSliderContainer = document.getElementById("slr-slider");
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

      const assetsList = document.getElementById("assets-list");
      const itemsList = document.getElementById("items-list");
      const backLink = document.getElementById("back-link");
      const assetTitle = document.getElementById("asset-title");
      const selectAll = document.getElementById("select-all");
      const selectNode = document.getElementById("select-none");

      this.enableFeaturesList = assetLayerTitle => {
        if(assetLayerTitle != null){
          assetTitle.innerHTML = assetLayerTitle;
          assetsList.classList.add("hide");
          itemsList.classList.remove("hide");
          backLink.classList.remove("btn-disabled");
        } else {
          assetTitle.innerHTML = "";
          assetsList.classList.remove("hide");
          itemsList.classList.add("hide");
          backLink.classList.add("btn-disabled");
        }
      };

      backLink.addEventListener("click", () => {
        this.enableFeaturesList();
      });

      selectAll.addEventListener("click", () => {
        document.querySelectorAll(".status-left-items").forEach(node => {
          if(node.querySelector(".icon-ui-dark-blue").classList.contains('icon-ui-checkbox-unchecked')){
            node.click();
          }
        });
      });

      selectNode.addEventListener("click", () => {
        document.querySelectorAll(".status-left-items").forEach(node => {
          if(node.querySelector(".icon-ui-dark-blue").classList.contains('icon-ui-checkbox-checked')){
            node.click();
          }
        });
      });


      this.on("analysis-status", options => {
        switch(options.status){
          case "suspended":
          case "not suspended":
            view.container.classList.toggle("is-active", false);
            this.enableFeaturesList();
            break;
          case "start":
            view.container.classList.toggle("is-active", true);
            this.enableFeaturesList();
            break;
          case "end":
            view.container.classList.toggle("is-active", view.updating);
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

      const assetsList = document.getElementById("assets-list");
      const itemsList = document.getElementById("items-list");

      const statusNode = domConstruct.create("div", { className: "status-node side-nav-link font-size-0 btn-disabled" }, assetsList, placement || "last");

      const leftItems = domConstruct.create("span", { className: "status-left-items" }, statusNode);
      const visibilityNode = domConstruct.create("span", { className: "icon-ui-dark-blue" }, leftItems);
      visibilityNode.classList.toggle("icon-ui-checkbox-checked", assetLayer.visible);
      visibilityNode.classList.toggle("icon-ui-checkbox-unchecked", !assetLayer.visible);

      const symbolNode = domConstruct.create("span", { className: "status-symbol-node margin-right-half" }, leftItems);
      const defaultSymbol = (assetLayer.renderer.type === "simple") ? assetLayer.renderer.symbol : (assetLayer.renderer.defaultSymbol || assetLayer.renderer.uniqueValueInfos[0].symbol);
      symbolUtils.renderPreviewHTML(defaultSymbol, { node: symbolNode, size: 16 });

      const titleNode = domConstruct.create("span", { className: "", innerHTML: assetLayer.title }, leftItems);

      const rightItems = domConstruct.create("span", { className: "" }, statusNode);
      const countNode = domConstruct.create("span", { className: "avenir-demi right", innerHTML: "--" }, rightItems);
      const itemListNode = domConstruct.create("span", { title: "View list of affected assets...", className: "icon-ui-description right hide" }, rightItems);


      const clearStatusUI = () => {
        countNode.innerHTML = "--";
        statusNode.classList.remove("text-red");
        itemListNode.classList.add("hide");
      };

      return assetLayer.load().then(() => {

        assetLayer.outFields = ["*"];
        assetLayer.popupEnabled = true;
        assetLayer.minScale = this.analysisMinScale;

        const objectIdField = assetLayer.objectIdField;

        return view.whenLayerView(assetLayer).then(assetLayerView => {
          statusNode.classList.remove("btn-disabled");

          watchUtils.init(assetLayerView, "suspended", suspended => {
            statusNode.classList.toggle("suspended", suspended);
          });

          let highlight = null;
          let waterLevel = 0;
          let affectedFeatures = null;

          const countFormatter = new Intl.NumberFormat('default');

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
                    countNode.innerHTML = countFormatter.format(affectedCount);

                    statusNode.classList.toggle("text-red", (affectedCount > 0));
                    itemListNode.classList.toggle("hide", (affectedCount === 0));

                    highlight && highlight.remove();
                    const objectIds = affectedFeatures.map(f => f.attributes[objectIdField]);
                    highlight = assetLayerView.highlight(objectIds);

                    resolve();
                  }).catch(reject);
                });
              } else { resolve(); }
            });
          });

          const _ignoreAbortErrors = error => {
            if(error.name !== 'AbortError'){ console.error(error); }
          }

          //
          //
          //
          leftItems.addEventListener("click", leftItemsClickEvt => {
            leftItemsClickEvt && leftItemsClickEvt.stopPropagation();
            visibilityNode.classList.toggle("icon-ui-checkbox-checked");
            visibilityNode.classList.toggle("icon-ui-checkbox-unchecked");
            assetLayer.visible = visibilityNode.classList.contains("icon-ui-checkbox-checked");
            updateAnalysis().catch(_ignoreAbortErrors);
          });

          //
          //
          //
          itemListNode.addEventListener("click", itemListClickEvt => {
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

        // https://developers.arcgis.com/javascript/latest/api-reference/esri-rest-imageService.html#getSamples
        // https://developers.arcgis.com/javascript/latest/api-reference/esri-rest-support-ImageSampleParameters.html

        return waterLevelLayer.getSamples({
          geometry: location.toJSON(),
          returnFirstValueOnly: true,
          pixelSize: "12,12",
          interpolation: "nearest"
        }).then((samplesResponse) => {
          const samples = samplesResponse.data.samples;
          if(samples.length){
            return Number(samples[0].value);
          } else {
            return null;
          }
        });

      };
    }

  });
});

