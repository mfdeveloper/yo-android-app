const Generator = require('yeoman-generator');
const Octokit = require('@octokit/rest');
const xml2json = require('xml2json');
const xmlBeautifier = require('xml-beautifier');
const android = require('android-versions');
const fs = require('fs-extra');
const path = require('path');

module.exports = class extends Generator {

    constructor(args, opts) {

        // Calling the super constructor is important so our generator is correctly set up
        super(args, opts);

        this.defaultRemote = 'github';

        this.option('exclude-dependencies', {
            alias: 'deps',
            type: Boolean,
            description: 'Exclude default dependencies into build.gradle of library module'
        });

        this.option('git-fork', {
            alias: 'fork',
            type: String,
            description: 'Create a fork into a remote git? (github, by default)',
            default: this.defaultRemote
        });

        this.option('git-remote-token', {
            alias: 'token',
            type: String,
            description: 'Github API token. Need this to use together with --git-fork option'
        });

        // Github API with personal access token
        if (this.options.gitFork) {

            this.remoteToken = process.env.GITREMOTE_TOKEN || this.options.gitRemoteToken;

            // if (this.fs.exists(this.destinationPath('.gitremote-token'))) {

            //     this.remoteToken = this.fs.read(this.destinationPath('.gitremote-token'));
        }

        if (this.remoteToken && this.remoteToken.length > 0) {

            this.remoteRest = new Octokit({
                auth: `token ${this.remoteToken}`
            });
        }

        // Is a Cordova Plugin ?
        this.prepareCordovaLib();

    }

    async prompting() {

        this.answers = await this.prompt([
            {
                type: 'input',
                name: 'name',
                message: 'Name of your library',
                default: 'Lib'
            },
            {
                type: 'input',
                name: 'package',
                message: 'Package name for your library',
                default: (answers) => this.package ? `${this.package}.${answers.name.toLowerCase()}` : 'com.example.app'
            },
            {
                type: 'input',
                name: 'gitUsername',
                message: 'Git remote username',
                when: !!(this.options.gitFork && !this.remoteToken),
                validate: (value) => !value || value.length == 0 ? 'Username is required!' : true
            },
            {
                type: 'password',
                name: 'gitPassword',
                message: 'Git remote password',
                when: !!(this.options.gitFork && !this.remoteToken),
                validate: (value, answers) => {

                    if (!value || value.length == 0) {
                        return 'Password is required';
                    }

                    if (!this.remoteToken) {
                        this.remoteRest = new Octokit({
                            auth: {
                                username: answers.gitUsername,
                                password: value
                            }
                        });
                    }

                    return true;
                }
            },
            {
                type: 'list',
                name: 'remoteGroup',
                message: 'Which remote organization/group to fork this project?',
                when: !!(this.options.gitFork && this.remoteRest),
                choices: async () => {

                    return await this.remoteRest.orgs.listForAuthenticatedUser().then((result) => {
                        return result.data.map((data) => {
                            return { name: data.login, value: data.login };
                        });
                    })

                },
                filter: value => {
                    let remote = this.options.gitFork || this.options.fork;
                    if (typeof remote == 'boolean') {
                        remote = this.defaultRemote;
                    }
                    return `com.${remote}.${value}`;
                }
            },
            {
                type: 'list',
                name: 'lang',
                message: 'Java or Kotlin?',
                choices: [
                    {
                        name: 'Java',
                        value: 'java'
                    }
                ]
            },
            {
                type: 'list',
                name: 'minSdkVersion',
                message: 'Minimum Android SDK',
                default: () => this.getAndroidVersions().findIndex(version => version.value == 19),
                choices: () => this.getAndroidVersions()
            },
            {
                type: 'list',
                name: 'targetSdkVersion',
                message: 'Target Android SDK',
                default: () => {

                    const result = this.getAndroidVersions();
                    return result.length - 1;
                },
                choices: () => {
                    return this.getAndroidVersions();
                }
            }
        ]);

        this.answers.module = this.answers.name.toLowerCase();
    }

    writing() {

        this.normalizeFilePaths();

        const rootGradleSettings = this.destinationPath('android/settings.gradle');
        const gradleModuleFile = this.destinationPath(`android/${this.answers.module}/build.gradle`);

        var tplValues = {
            package: this.answers.package,
            name: this.answers.name,
            module: this.answers.module,
            minSdkVersion: this.answers.minSdkVersion,
            targetSdkVersion: this.answers.targetSdkVersion,
            lang: this.answers.lang,
            dependencies: '',
            remoteGroup: this.answers.remoteGroup,
            extend: {
                manifest: '',
                application: ''    
            }
        };

        if (!this.options.excludeDependencies) {
            this.dependencies.forEach(dep => tplValues.dependencies += `implementation '${dep.value}'\n\t`)
        }

        this.fs.copyTpl(
            this.templatePath(this.answers.lang),
            this.destinationPath(`android/${this.answers.module}`),
            tplValues
        );

        if (this.fs.exists(rootGradleSettings)) {
            var settings = this.fs.read(rootGradleSettings);
            settings += `, :'${this.answers.module}'`;

            this.fs.write(rootGradleSettings, settings);
        }

        if (this.gradleExtraFile) {
            let gradleModule = this.fs.read(gradleModuleFile);
            gradleModule = `
            \rdef hasBuildExtras = file('${path.basename(this.gradleExtraFile.src)}').exists()
            \rif (hasBuildExtras) {
                \r\tapply from: '${path.basename(this.gradleExtraFile.src)}'
            \r}
            \r` + gradleModule;

            this.fs.write(gradleModuleFile, gradleModule);

            if(this.fs.exists(this.destinationPath(this.gradleExtraFile.src))) {
                this.fs.copyTpl(
                    this.destinationPath(this.gradleExtraFile.src),
                    this.destinationPath(`android/${this.answers.module}/${path.basename(this.gradleExtraFile.src)}`)
                );
            }
        }

        if (this.manifestExtra 
            && /AndroidManifest/.test(this.manifestExtra.target) 
            && /application/.test(this.manifestExtra.parent)) {

            this.extendManifestTpl();
        }
    }

    end() {
        
        if (this.firstSourceFile && /\.java/.test(this.firstSourceFile.src)) {
            
            if (this.fs.exists(this.destinationPath(this.firstSourceFile.src))) {
                
                this.fs.delete([this.destinationPath('src/android') + '/*.java', '!' + this.destinationPath('src/android') + '/**/*.java']);
                this.log().info('Cleanup original %s files', '*.java');
            }
        }
    }

    extendManifestTpl() {

        if (this.manifestExtra && this.manifestExtra.parent) {
            
            let parentTag = this.manifestExtra.parent.split('/');
            if (parentTag.length > 0 && parentTag[parentTag.length -1] != '*') {
                parentTag = parentTag[parentTag.length -1] || 'application'
            }
    
            delete this.manifestExtra.target;
            delete this.manifestExtra.parent;
            
            const manifestXml = xml2json.toXml(this.manifestExtra);
    
            this.fs.copyTpl(
                `${this.sourceRoot().replace('lib', 'app')}/${this.answers.lang}/app/src/main/AndroidManifest.xml`,
                this.destinationPath('android/app/src/main/AndroidManifest.xml'),
                {
                    package: this.answers.package,
                    extend: {
                        [parentTag]: xmlBeautifier(manifestXml)    
                    }
                }
            )
        }
    }

    prepareCordovaLib() {

        if (this.fs.exists(this.destinationPath('plugin.xml'))) {
            var xml = this.fs.read(this.destinationPath('plugin.xml'));
            if (xml) {
                
                const jsonData = xml2json.toJson(xml, { object: true, reversible: true, trim: false });
                if (jsonData && jsonData.plugin) {
                    const platform = jsonData.plugin.platform.find(p => p.name == 'android');
                    if (platform) {
                        this.dependencies = [
                            {
                                name: 'cordova-android',
                                value: 'com.github.mfdeveloper:cordova-android:7.1.1'
                            }
                        ];

                        if (platform['config-file']) {
                            const cbManifest = c => c.target == 'AndroidManifest.xml';
                            
                            if (platform['config-file'] instanceof Array) {
                                this.manifestExtra = platform['config-file'].find(cbManifest);
                            } else {
                                this.manifestExtra = cbManifest(platform['config-file']);
                            }
                        }

                        if (platform['framework']) {
                            this.gradleExtraFile = platform['framework'] instanceof Array ? platform['framework'].find(f => /\.gradle/.test(f.src)) : /\.gradle/.test(platform['framework'].src) ? platform['framework'] : null;
                        }

                        if (platform['source-file']) {
                            this.firstSourceFile = platform['source-file'] instanceof Array ? platform['source-file'][0] : platform['source-file'];
                        }
                        this.packagePath = this.firstSourceFile['target-dir'].replace('src/', '');
                        this.package = this.packagePath.replace(/\//g, '\.');
                    }
                }
            }
        }
    }

    normalizeFilePaths() {
        if (this.packagePath) {
            const fullPackagePath = this.destinationPath(`src/android/${this.packagePath}`);
            if (!this.fs.exists(fullPackagePath)) {
                fs.ensureDirSync(fullPackagePath);
            }

            if (!this.fs.exists(`${fullPackagePath}/${path.basename(this.firstSourceFile.src)}`)) {

                const androidFilesPath = this.destinationPath('src/android');

                try {
                    this.fs.copy(androidFilesPath + '/*.java', fullPackagePath);
                } catch (error) {
                    if (!/does not exist/.test(error.message)) {
                        throw error;
                    }
                }
            }
            
        }
    }

    getAndroidVersions() {
        // API 15: Android 4.4 (JellyBean)
        this.androidListVersions = this.androidListVersions || android.getAll((version) => {
            return version.api >= 14
        }).map(version => {
            return {
                name: `API ${version.api}: Android ${version.semver} (${version.name})`,
                value: version.api
            }
        });

        return this.androidListVersions;
    }
}
