// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

'use strict';

var Protocol = require('azure-iot-device-mqtt').Mqtt;
var Client = require('azure-iot-device').Client;
var Message = require('azure-iot-device').Message;

const packageJson = require('./package.json');

// String containing Hostname, Device Id & Device Key in the following formats:
//  'HostName=<iothub_host_name>;DeviceId=<device_id>;SharedAccessKey=<device_key>'
const deviceConnectionString = process.env.DEVICE_CONNECTION_STRING;

const modelId = 'dtmi:com:example:SampleDevice;1';
const messageSubjectProperty = '$.sub';
const sensorComponentName = 'sensor';
const deviceInfoComponentName = 'deviceInformation';
const sdkInfoComponentName = 'sdkInformation';
const componentPrefix = '$iotin:';
const commandComponentCommandNameSeparator = '*';

const commandNameBlink = componentPrefix + sensorComponentName + commandComponentCommandNameSeparator + 'blink';
const commandNameTurnOn = componentPrefix + sensorComponentName + commandComponentCommandNameSeparator + 'turnOn';
const commandNameTurnOff = componentPrefix + sensorComponentName + commandComponentCommandNameSeparator + 'turnOff';

const propertyUpdateHandler = (deviceTwin, componentName, propertyName, reportedValue, desiredValue, version) => {
  console.log('Received an update for component: ' + componentName + ' and property: ' + propertyName + ' with value: ' + JSON.stringify(desiredValue));
  const patch = helperCreateReportedPropertiesPatch(
    { [propertyName]: desiredValue}, 
      componentName,
      {
        code: 200,
        description: 'Successfully executed patch for ' + propertyName,
        version: version
      }
    )
  updateComponentReportedProperties(deviceTwin, patch, componentName);
  console.log('updated the property');
};


const commandHandler = async (request, response) => {
  switch (request.methodName) {
  case commandNameBlink: {
    await sendCommandResponse(request, response, 200, 'blink response')
    break;
  }
  case commandNameTurnOn: {
    await sendCommandResponse(request, response, 200, 'turn On response')
    break;
  }
  case commandNameTurnOff: {
    await sendCommandResponse(request, response, 200, 'turn Off response')
    break;
  }
  default: // Is there no way to register for an unknown method?
    await sendCommandResponse(request, response, 404, 'unknown method')
    break;
  }
};

// TODO Not sure if this needs to be async or not coz we probably dont care if the response rached Hub.
const sendCommandResponse = async (request, response, status, payload) => {
  helperLogCommandRequest(request);
  try {
    await response.send(status, payload)
    console.log('Response to method \'' + request.methodName +
              '\' sent successfully.' );
  }
  catch (err){
    console.error('An error ocurred when sending a method response:\n' +
              err.toString());
  }
};

const helperLogCommandRequest = (request) => {
  console.log('Received command request for comand name \'' + request.methodName + '\'');

  if(!!(request.payload)) {
    console.log('The command request paylaod :')
    console.log(request.payload);
  }
};

const helperCreateReportedPropertiesPatch = (propertiesToReport, componentName, actualResponse) => {
  let componentPart = componentPrefix + componentName;
  let patch = {[componentPart]: {}}
  
  for (const propertyName in propertiesToReport) {
    let propertyContent = { value: propertiesToReport[propertyName] };
    if (actualResponse) {
      propertyContent.ac = actualResponse.code;
      propertyContent.ad = actualResponse.description;
      propertyContent.av = actualResponse.version;
    }
    patch[componentPart][propertyName] = propertyContent;
  }
  console.log('The following properties will be updated for component:' + componentName)
  console.log(patch)
  return patch
}

const updateComponentReportedProperties = (deviceTwin, patch, componentName) => {
  deviceTwin.properties.reported.update(patch, function(err) {
    if (err) throw err;
    console.log('Properties have been reported for component:' +  componentName);
  });
}

const helperAttachHandlerForDesiredPropertyPatches = (deviceTwin, componentName) => {

  let prefixAndComponentName = componentPrefix + componentName
  const versionProperty = '$version';

  deviceTwin.on('properties.desired.' + prefixAndComponentName, (delta) => {
    Object.entries(delta).forEach(([propertyName, propertyValue]) => {
      propertyUpdateHandler(deviceTwin, componentName, propertyName, null, propertyValue.value, deviceTwin.properties.desired[versionProperty]);
   });
  });  
}


const sendTelemetryAtInterval = async (device_client, componentName, secs) => {
  let index = 0;
  let interval = parseFloat(secs)*1000
  setInterval( async () => {
    console.log('Sending telemetry message %d...', index);
    var data = JSON.stringify({ temp: 1 + (Math.random() * 90), humidity: 1 + (Math.random() * 99) })
    var pnp_msg = new Message(data);
    pnp_msg.properties.add(messageSubjectProperty, componentName);
    pnp_msg.contentType =  'application/json';
    pnp_msg.contentEncoding = 'utf-8';
    await device_client.sendEvent(pnp_msg);
    index += 1;
  }, interval);
}

async function main() {
  // fromConnectionString must specify a transport, coming from any transport package.
  var client = Client.fromConnectionString(deviceConnectionString, Protocol);
  console.log('Connecting using connection string ' + deviceConnectionString)
  let resultTwin;
  try
  {
      // Add the modelId here
      await client.setOptions({ modelId: modelId });
      await client.open()
      console.log('Enabling the commands on the client');
      client.onDeviceMethod(commandNameBlink, commandHandler);
      client.onDeviceMethod(commandNameTurnOn, commandHandler);
      client.onDeviceMethod(commandNameTurnOff, commandHandler);
      // Is there no way to register for an unknown method ?

      // Send Telemetry every 5.5 secs
      await sendTelemetryAtInterval(client, sensorComponentName, 5.5);

      try 
      {
          resultTwin = await client.getTwin()
          const patchDeviceInfo = helperCreateReportedPropertiesPatch({
            manufacturer: 'Contoso Device Corporation',
            model: 'Contoso 47-turbo',
            swVersion: '10.89',
            osName: 'Contoso_OS',
            processorArchitecture: 'Contoso_x86',
            processorManufacturer: 'Contoso Industries',
            totalStorage: 65000,
            totalMemory: 640,
          }, deviceInfoComponentName)

          const patchSDKInfo = helperCreateReportedPropertiesPatch({
            language: 'node.js',
            version: packageJson.version,
            vendor: 'Microsoft'
          }, sdkInfoComponentName)

          const patchSensorInfo = helperCreateReportedPropertiesPatch({
            name: 'Node Sample Device',
            state: true,
            brightness: '10'
          }, sensorComponentName)
          
          // the below things can only happen once the twin is there
          updateComponentReportedProperties(resultTwin, patchDeviceInfo, deviceInfoComponentName)
          updateComponentReportedProperties(resultTwin, patchSDKInfo, sdkInfoComponentName);
          updateComponentReportedProperties(resultTwin, patchSensorInfo, sensorComponentName);
          helperAttachHandlerForDesiredPropertyPatches(resultTwin, sensorComponentName);
      }
      catch (err) 
      {
          console.error('could not get twin\n' + err.toString())
      }
  }
  catch (err) 
  {
      console.error('could not connect pnp client\n' + err.toString())
  }
}

main().then(()=> console.log('executed sample')).catch((err) =>  console.log('error', err))
